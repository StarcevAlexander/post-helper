package store

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func openTestStore(t *testing.T) *Postgres {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	p, err := Open(context.Background(), url, slog.Default())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func waitFor(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("condition was not met in time")
}

func TestErrorHandlerStoresOnlyErrors(t *testing.T) {
	p := openTestStore(t)
	marker := "slog-" + time.Now().Format("150405.000000")
	logger := slog.New(NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), p)).With("component", "test")
	logger.Info("not stored " + marker)
	logger.Error(marker, slog.String("path", "/x"))

	waitFor(t, func() bool {
		var stored int
		err := p.Pool().QueryRow(context.Background(),
			"SELECT COUNT(*) FROM error_log WHERE message = $1 AND source = $2", marker, ErrorSourceServer).Scan(&stored)
		return err == nil && stored == 1
	})
	var leaked int
	if err := p.Pool().QueryRow(context.Background(),
		"SELECT COUNT(*) FROM error_log WHERE message = $1", "not stored "+marker).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("info record must not be stored, count = %d, err = %v", leaked, err)
	}
}

func TestPurgeDropsOldLogs(t *testing.T) {
	p := openTestStore(t)
	marker := "purge-" + time.Now().Format("150405.000000")
	ctx := context.Background()
	if _, err := p.Pool().Exec(ctx, "INSERT INTO error_log (source, message, created_at) VALUES ($1, $2, now() - interval '200 days')", ErrorSourceServer, marker+"-old"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Pool().Exec(ctx, "INSERT INTO error_log (source, message) VALUES ($1, $2)", ErrorSourceServer, marker+"-new"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Purge(ctx, time.Now().AddDate(0, 0, -LogRetentionDays)); err != nil {
		t.Fatal(err)
	}
	var old, fresh int
	_ = p.Pool().QueryRow(ctx, "SELECT COUNT(*) FROM error_log WHERE message = $1", marker+"-old").Scan(&old)
	_ = p.Pool().QueryRow(ctx, "SELECT COUNT(*) FROM error_log WHERE message = $1", marker+"-new").Scan(&fresh)
	if old != 0 || fresh != 1 {
		t.Fatalf("old = %d, fresh = %d", old, fresh)
	}
}

func lazyStore(t *testing.T) *Postgres {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "postgres://user:pass@127.0.0.1:1/none")
	if err != nil {
		t.Fatal(err)
	}
	return newPostgres(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestSaveAfterCloseIsDroppedWithoutPanic(t *testing.T) {
	p := lazyStore(t)
	p.Close()
	p.Close()

	p.SaveError(ErrorSourceServer, "late", nil)
	logger := slog.New(NewErrorHandler(slog.NewTextHandler(io.Discard, nil), p))
	logger.Error("late log after close")
}

func TestConcurrentSaveAndCloseDoNotPanic(t *testing.T) {
	p := lazyStore(t)
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			for range 200 {
				p.SaveError(ErrorSourceServer, "race", nil)
			}
		}()
	}
	p.Close()
	group.Wait()
}
