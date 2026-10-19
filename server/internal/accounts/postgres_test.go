package accounts_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/store"
)

func openPostgres(t *testing.T) *accounts.Postgres {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	postgres, err := store.Open(context.Background(), url, slog.Default())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(postgres.Close)
	return accounts.NewPostgres(postgres.Pool())
}

func TestPostgresMastersStateAndUsage(t *testing.T) {
	db := openPostgres(t)
	ctx := context.Background()
	hash := "test-hash-" + time.Now().Format("150405.000000000")

	master, err := db.CreateMaster(ctx, "Тест", hash)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	found, err := db.FindByCodeHash(ctx, hash)
	if err != nil || found.ID != master.ID || found.Disabled {
		t.Fatalf("find = %+v, %v", found, err)
	}
	if _, err := db.FindByCodeHash(ctx, "missing-"+hash); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := db.Touch(ctx, master.ID, time.Now()); err != nil {
		t.Fatalf("touch: %v", err)
	}
	if err := db.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := db.SetDisabled(ctx, "missing", true); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	if _, err := db.LoadState(ctx, master.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	first, err := db.SaveState(ctx, master.ID, 0, json.RawMessage(`{"a":1}`), time.Now())
	if err != nil || first.Version != 1 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := db.SaveState(ctx, master.ID, 1, json.RawMessage(`{"a":2}`), time.Now())
	if err != nil || second.Version != 2 {
		t.Fatalf("second = %+v, %v", second, err)
	}
	stale, err := db.SaveState(ctx, master.ID, 1, json.RawMessage(`{"a":3}`), time.Now())
	if !errors.Is(err, accounts.ErrConflict) || stale.Version != 2 {
		t.Errorf("stale = %+v, %v", stale, err)
	}
	if _, err := db.SaveState(ctx, master.ID, 0, json.RawMessage(`{}`), time.Now()); !errors.Is(err, accounts.ErrConflict) {
		t.Errorf("a repeated first save must conflict, got %v", err)
	}
	loaded, err := db.LoadState(ctx, master.ID)
	if err != nil || loaded.Version != 2 {
		t.Fatalf("loaded = %+v, %v", loaded, err)
	}

	day := time.Now().Add(-time.Hour)
	if err := db.RecordUsage(ctx, master.ID, "kit", time.Now()); err != nil {
		t.Fatalf("usage: %v", err)
	}
	count, err := db.CountUsage(ctx, master.ID, day)
	if err != nil || count != 1 {
		t.Errorf("count = %d, %v", count, err)
	}
	list, err := db.ListMasters(ctx, day)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, summary := range list {
		if summary.ID == master.ID && (summary.UsageToday != 1 || !summary.Disabled) {
			t.Errorf("summary = %+v", summary)
		}
	}
}
