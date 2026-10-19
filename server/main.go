package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/chat"
	"post-helper/server/internal/config"
	"post-helper/server/internal/httpapi"
	"post-helper/server/internal/kit"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/review"
	"post-helper/server/internal/store"
	"post-helper/server/internal/strategy"
)

const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 150 * time.Second
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
		logger = slog.New(store.NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), history))
		slog.SetDefault(logger)
	} else {
		slog.Warn("DATABASE_URL is not set: history, master accounts and master data live in memory and are lost on restart")
	}
	defer history.Close()

	ctxRetention, stopRetention := context.WithCancel(context.Background())
	defer stopRetention()
	go runRetention(ctxRetention, accountStore, cfg.RetentionDays)

	claude := chat.NewClaude(cfg.APIKey, cfg.Model)
	handler := httpapi.NewHandler(httpapi.Options{
		Responder:      claude,
		Strategist:     strategy.NewClaude(cfg.APIKey, cfg.Model),
		KitMaker:       kit.NewClaude(cfg.APIKey, cfg.Model),
		Reviewer:       review.NewClaude(cfg.APIKey, cfg.Model),
		Auditor:        audit.NewClaude(cfg.APIKey, cfg.Model),
		AgentToken:     cfg.AgentToken,
		Refs:           refsStore,
		RefPlanner:     refs.NewClaude(cfg.APIKey, cfg.Model),
		Accounts:       accountStore,
		DailyAILimit:   cfg.DailyAILimit,
		RetentionDays:  cfg.RetentionDays,
		Password:       cfg.AccessPassword,
		AllowedOrigins: cfg.AllowedOrigins,
		Store:          history,
		Logger:         logger,
	})
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		slog.Info("listening", slog.String("addr", server.Addr), slog.String("model", cfg.Model))
		serverErr <- server.ListenAndServe()
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
		return server.Shutdown(shutdownCtx)
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
