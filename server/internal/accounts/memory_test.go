package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestMemoryStateVersions(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()

	if _, err := store.LoadState(ctx, "m1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	first, err := store.SaveState(ctx, "m1", 0, json.RawMessage(`{"a":1}`), now)
	if err != nil || first.Version != 1 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := store.SaveState(ctx, "m1", 1, json.RawMessage(`{"a":2}`), now)
	if err != nil || second.Version != 2 {
		t.Fatalf("second = %+v, %v", second, err)
	}

	stale, err := store.SaveState(ctx, "m1", 1, json.RawMessage(`{"a":3}`), now)
	if !errors.Is(err, ErrConflict) || stale.Version != 2 || string(stale.Data) != `{"a":2}` {
		t.Errorf("stale = %+v, %v", stale, err)
	}
	if _, err := store.SaveState(ctx, "m1", 0, json.RawMessage(`{}`), now); !errors.Is(err, ErrConflict) {
		t.Errorf("a second first save must conflict, got %v", err)
	}
}

func TestMemoryUsageCounts(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	other, _ := store.CreateMaster(ctx, "Вера", "hash2")
	day := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	_ = store.RecordUsage(ctx, master.ID, "kit", day.Add(-time.Hour))
	_ = store.RecordUsage(ctx, master.ID, "kit", day.Add(time.Hour))
	_ = store.RecordUsage(ctx, master.ID, "strategy", day.Add(2*time.Hour))
	_ = store.RecordUsage(ctx, other.ID, "kit", day.Add(time.Hour))

	today, _ := store.CountUsage(ctx, master.ID, day)
	list, _ := store.ListMasters(ctx, day)

	if today != 2 {
		t.Errorf("today = %d", today)
	}
	byID := map[string]MasterSummary{}
	for _, summary := range list {
		byID[summary.ID] = summary
	}
	if len(list) != 2 || byID[master.ID].UsageToday != 2 || byID[master.ID].UsageTotal != 3 || byID[other.ID].UsageTotal != 1 {
		t.Errorf("list = %+v", list)
	}
}

func TestMemoryMasters(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")

	found, err := store.FindByCodeHash(ctx, "hash")
	if err != nil || found.ID != master.ID {
		t.Fatalf("found = %+v, %v", found, err)
	}
	if _, err := store.FindByCodeHash(ctx, "other"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := store.SetDisabled(ctx, "missing", true); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := store.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatal(err)
	}
	found, _ = store.FindByCodeHash(ctx, "hash")
	if !found.Disabled {
		t.Error("master must be disabled")
	}
}
