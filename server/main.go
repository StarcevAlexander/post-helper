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
	"post-helper/server/internal/digest"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/httpapi"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/media"
	"post-helper/server/internal/notices"
	"post-helper/server/internal/places"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/reminders"
	"post-helper/server/internal/store"
	"post-helper/server/internal/yandex"
	"post-helper/server/internal/zai"
)

const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 10 * time.Minute
	writeTimeout      = 10 * time.Minute
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

	if err := cfg.RequireStore(); err != nil {
		return fmt.Errorf("config: %w", err)
	}

	logger := slog.Default()
	var history store.Store = store.Noop{}
	memoryAccounts := accounts.NewMemory()
	memoryAccounts.HistoryKeep = cfg.HistoryKeep
	var accountStore accounts.Store = memoryAccounts
	var refsStore refs.Store = refs.NewMemory()
	var mediaStore media.Store = media.NewMemory()
	var mediaFiles media.Files = media.NewMemoryFiles()
	var intakeStore intake.Store = intake.NewMemory()
	var feedbackStore feedback.Store = feedback.NewMemory()
	var pushStore push.Store = push.NewMemory()
	var reminderSent reminders.Sent = reminders.NewMemory()
	var noticeStore notices.Store = notices.NewMemory()
	var digestSent digest.Sent = digest.NewMemory()
	var pingDatabase func(context.Context) error
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
		mediaStore = media.NewPostgres(postgres.Pool())
		diskFiles, err := media.NewDiskFiles(cfg.MediaDir)
		if err != nil {
			return fmt.Errorf("media: %w", err)
		}
		mediaFiles = diskFiles
		intakeStore = intake.NewPostgres(postgres.Pool())
		feedbackStore = feedback.NewPostgres(postgres.Pool())
		pushStore = push.NewPostgres(postgres.Pool())
		reminderSent = reminders.NewPostgres(postgres.Pool())
		noticeStore = notices.NewPostgres(postgres.Pool())
		digestSent = digest.NewPostgres(postgres.Pool())
		logger = slog.New(store.NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), history))
		slog.SetDefault(logger)
		pingDatabase = postgres.Pool().Ping
	} else {
		slog.Warn("ALLOW_MEMORY_STORE=1 and DATABASE_URL is not set: master accounts and master data live in memory and are lost on restart")
	}
	defer history.Close()

	ctxRetention, stopRetention := context.WithCancel(context.Background())
	defer stopRetention()
	go runRetention(ctxRetention, accountStore, history, cfg.RetentionDays, mediaStore, mediaFiles, cfg.MediaKeepDays, noticeStore)

	var notifier intake.Notifier
	if telegram := intake.NewTelegram(cfg.TelegramToken, cfg.TelegramChatID); telegram != nil {
		notifier = telegram
	} else if cfg.TelegramToken != "" || cfg.TelegramChatID != "" {
		slog.Warn("only one of TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID is set: owner notifications are off")
	}
	ownerLocation := reminderLocation(cfg.ReminderTimezone)
	var pusher push.Sender
	if service := push.New(pushStore, cfg.VapidPublicKey, cfg.VapidPrivateKey, cfg.VapidSubject); service != nil {
		pusher = &notices.Recorder{Sender: service, Store: noticeStore, Logger: logger}
		go (&reminders.Scheduler{
			Accounts: accountStore,
			Sender:   pusher,
			Sent:     reminderSent,
			Location: ownerLocation,
			Logger:   logger,
		}).Run(ctxRetention)
	} else {
		slog.Warn("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set: push notifications are off")
	}
	var weeklyDigest httpapi.DigestSender
	if notifier != nil {
		scheduler := &digest.Scheduler{
			Accounts: accountStore,
			Pushes:   pushStore,
			Intakes:  intakeStore,
			Notifier: notifier,
			Sent:     digestSent,
			Location: ownerLocation,
			Logger:   logger,
		}
		weeklyDigest = scheduler
		go scheduler.Run(ctxRetention)
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

	zaiClient := zai.New(cfg.APIKey, cfg.BaseURL)
	options := httpapi.Options{
		Digest:         weeklyDigest,
		Shutdown:       stop,
		Yandex:         yandexLogin,
		YandexClientID: yandexClientID,
		Intake:         intakeStore,
		Notifier:       notifier,
		Feedback:       feedbackStore,
		PushStore:      pushStore,
		Pusher:         pusher,
		Notices:        noticeStore,
		Location:       ownerLocation,
		Auditor:        audit.NewZai(zaiClient, cfg.VisionModel),
		Refs:           refsStore,
		Media:          mediaStore,
		MediaFiles:     mediaFiles,
		MediaPlanner:   media.NewZai(zaiClient, cfg.VisionModel),
		RefPlanner:     refs.NewZai(zaiClient, cfg.Model),
		Places:         places.NewZai(zaiClient, cfg.Model),
		Accounts:       accountStore,
		RetentionDays:  cfg.RetentionDays,
		AllowedOrigins: cfg.AllowedOrigins,
		Store:          history,
		Ping:           pingDatabase,
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
		slog.Info("listening", slog.String("addr", server.Addr), slog.String("model", cfg.Model), slog.String("visionModel", cfg.VisionModel))
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

func runRetention(ctx context.Context, accountStore accounts.Store, logStore store.Store, days int, mediaStore media.Store, mediaFiles media.Files, mediaKeepDays int, noticeStore notices.Store) {
	purge := func() {
		purgeCtx, cancel := context.WithTimeout(ctx, retentionTimeout)
		defer cancel()
		purgeLogs(purgeCtx, logStore)
		purgeMedia(purgeCtx, mediaStore, mediaFiles, mediaKeepDays)
		purgeNotices(purgeCtx, noticeStore)
		if days > 0 {
			purgeAccounts(purgeCtx, accountStore, days)
		}
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

func purgeAccounts(ctx context.Context, accountStore accounts.Store, days int) {
	removed, err := accountStore.Purge(ctx, time.Now().AddDate(0, 0, -days))
	if err != nil {
		slog.Error("retention purge failed", slog.Any("error", err))
		return
	}
	slog.Info("retention purge done", slog.Int64("removed", removed), slog.Int("days", days))
}

func purgeMedia(ctx context.Context, mediaStore media.Store, mediaFiles media.Files, days int) {
	refs, err := mediaStore.Purge(ctx, time.Now().AddDate(0, 0, -days))
	if err != nil {
		slog.Error("media retention purge failed", slog.Any("error", err))
		return
	}
	if err := mediaFiles.Delete(ctx, refs...); err != nil {
		slog.Error("media files purge failed", slog.Any("error", err))
	}
	slog.Info("media retention purge done", slog.Int("files", len(refs)), slog.Int("days", days))
}

func purgeNotices(ctx context.Context, noticeStore notices.Store) {
	removed, err := noticeStore.Purge(ctx, time.Now().AddDate(0, 0, -notices.KeepDays))
	if err != nil {
		slog.Error("notification history purge failed", slog.Any("error", err))
		return
	}
	slog.Info("notification history purge done", slog.Int64("removed", removed), slog.Int("days", notices.KeepDays))
}

func purgeLogs(ctx context.Context, logStore store.Store) {
	removed, err := logStore.Purge(ctx, time.Now().AddDate(0, 0, -store.LogRetentionDays))
	if err != nil {
		slog.Warn("log retention purge failed", slog.Any("error", err))
		return
	}
	slog.Info("log retention purge done", slog.Int64("removed", removed), slog.Int("days", store.LogRetentionDays))
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
