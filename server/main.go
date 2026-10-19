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

	"post-helper/server/internal/chat"
	"post-helper/server/internal/config"
	"post-helper/server/internal/httpapi"
	"post-helper/server/internal/store"
)

const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 150 * time.Second
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second

	databaseOpenTimeout = 20 * time.Second
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
	if cfg.DatabaseURL != "" {
		openCtx, cancel := context.WithTimeout(context.Background(), databaseOpenTimeout)
		postgres, err := store.Open(openCtx, cfg.DatabaseURL, logger)
		cancel()
		if err != nil {
			return fmt.Errorf("store: %w", err)
		}
		history = postgres
		logger = slog.New(store.NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), history))
		slog.SetDefault(logger)
	} else {
		slog.Warn("DATABASE_URL is not set, history and error log are not stored")
	}
	defer history.Close()

	claude := chat.NewClaude(cfg.APIKey, cfg.Model)
	handler := httpapi.NewHandler(httpapi.Options{
		Responder:      claude,
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
