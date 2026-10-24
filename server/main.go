package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/config"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/httpapi"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/places"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/reminders"
	"post-helper/server/internal/store"
	"post-helper/server/internal/yandex"
)

const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 150 * time.Second
	adminReadTimeout  = 5 * time.Minute
	adminWriteTimeout = 5 * time.Minute
	adminHost         = "127.0.0.1"
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second

	databaseOpenTimeout = 20 * time.Second
	retentionInterval   = 24 * time.Hour
	retentionTimeout    = 2 * time.Minute
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", slog.Any("error", err))
		os.Exit(1)
	}
}

func run() error {
	if err := config.LoadDotEnv(config.DotEnvFileName); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	logger := slog.Default()
	var history store.Store = store.Noop{}
	memoryAccounts := accounts.NewMemory()
	memoryAccounts.HistoryKeep = cfg.HistoryKeep
	var accountStore accounts.Store = memoryAccounts
	var refsStore refs.Store = refs.NewMemory()
	var intakeStore intake.Store = intake.NewMemory()
	var feedbackStore feedback.Store = feedback.NewMemory()
	var pushStore push.Store = push.NewMemory()
	var reminderSent reminders.Sent = reminders.NewMemory()
	if cfg.DatabaseURL != "" {
		openCtx, cancel := context.WithTimeout(context.Background(), databaseOpenTimeout)
		postgres, err := store.Open(openCtx, cfg.DatabaseURL, logger)
		cancel()
		if err != nil {
			return fmt.Errorf("store: %w", err)
		}
		history = postgres
		postgresAccounts := accounts.NewPostgres(postgres.Pool())
		postgresAccounts.HistoryKeep = cfg.HistoryKeep
		accountStore = postgresAccounts
		refsStore = refs.NewPostgres(postgres.Pool())
		intakeStore = intake.NewPostgres(postgres.Pool())
		feedbackStore = feedback.NewPostgres(postgres.Pool())
		pushStore = push.NewPostgres(postgres.Pool())
		reminderSent = reminders.NewPostgres(postgres.Pool())
		logger = slog.New(store.NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), history))
		slog.SetDefault(logger)
	} else {
		slog.Warn("DATABASE_URL is not set: history, master accounts and master data live in memory and are lost on restart")
	}
	defer history.Close()

	ctxRetention, stopRetention := context.WithCancel(context.Background())
	defer stopRetention()
	go runRetention(ctxRetention, accountStore, cfg.RetentionDays)

	var notifier intake.Notifier
	if telegram := intake.NewTelegram(cfg.TelegramToken, cfg.TelegramChatID); telegram != nil {
		notifier = telegram
	} else if cfg.TelegramToken != "" || cfg.TelegramChatID != "" {
		slog.Warn("only one of TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID is set: owner notifications are off")
	}
	var pusher push.Sender
	if service := push.New(pushStore, cfg.VapidPublicKey, cfg.VapidPrivateKey, cfg.VapidSubject); service != nil {
		pusher = service
		go (&reminders.Scheduler{
			Accounts: accountStore,
			Sender:   pusher,
			Sent:     reminderSent,
			Location: reminderLocation(cfg.ReminderTimezone),
			Logger:   logger,
		}).Run(ctxRetention)
	} else {
		slog.Warn("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set: push notifications are off")
	}
	var yandexLogin yandex.Exchanger
	yandexClientID := ""
	if cfg.YandexClientID != "" && cfg.YandexClientSecret != "" {
		yandexLogin = yandex.NewClient(cfg.YandexClientID, cfg.YandexClientSecret)
		yandexClientID = cfg.YandexClientID
	} else {
		slog.Warn("YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET are not set: sign-in with Yandex is off")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	options := httpapi.Options{
		Shutdown:       stop,
		Yandex:         yandexLogin,
		YandexClientID: yandexClientID,
		Intake:         intakeStore,
		Notifier:       notifier,
		Feedback:       feedbackStore,
		PushStore:      pushStore,
		Pusher:         pusher,
		Auditor:        audit.NewClaude(cfg.APIKey, cfg.Model),
		Refs:           refsStore,
		RefPlanner:     refs.NewClaude(cfg.APIKey, cfg.Model),
		Places:         places.NewClaude(cfg.APIKey, cfg.Model),
		Accounts:       accountStore,
		RetentionDays:  cfg.RetentionDays,
		AllowedOrigins: cfg.AllowedOrigins,
		Store:          history,
		Logger:         logger,
	}
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewHandler(options),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	adminServer := &http.Server{
		Addr:              net.JoinHostPort(adminHost, cfg.AdminPort),
		Handler:           httpapi.NewAdminHandler(options),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       adminReadTimeout,
		WriteTimeout:      adminWriteTimeout,
		IdleTimeout:       idleTimeout,
	}

	serverErr := make(chan error, 2)
	go func() {
		slog.Info("listening", slog.String("addr", server.Addr), slog.String("model", cfg.Model))
		serverErr <- server.ListenAndServe()
	}()
	go func() {
		slog.Info("admin listening", slog.String("addr", adminServer.Addr))
		serverErr <- adminServer.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		adminErr := adminServer.Shutdown(shutdownCtx)
		return errors.Join(server.Shutdown(shutdownCtx), adminErr)
	}
}

func runRetention(ctx context.Context, store accounts.Store, days int) {
	if days <= 0 {
		return
	}
	purge := func() {
		before := time.Now().AddDate(0, 0, -days)
		purgeCtx, cancel := context.WithTimeout(ctx, retentionTimeout)
		defer cancel()
		removed, err := store.Purge(purgeCtx, before)
		if err != nil {
			slog.Error("retention purge failed", slog.Any("error", err))
			return
		}
		slog.Info("retention purge done", slog.Int64("removed", removed), slog.Int("days", days))
	}
	purge()
	ticker := time.NewTicker(retentionInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purge()
		}
	}
}

func reminderLocation(name string) *time.Location {
	if name == "" {
		return time.Local
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		slog.Warn("REMINDER_TIMEZONE is not a known time zone: the server time zone is used", slog.String("name", name))
		return time.Local
	}
	return location
}
