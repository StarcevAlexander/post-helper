package intake_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/store"
)

func TestPostgresIntakeLifecycle(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	postgres, err := store.Open(ctx, url, slog.Default())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(postgres.Close)
	people := accounts.NewPostgres(postgres.Pool())
	db := intake.NewPostgres(postgres.Pool())
	now := time.Now()
	master, err := people.CreateMaster(ctx, "Тест заявок", "intake-hash-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })

	if _, err := db.Latest(ctx, master.ID); !errors.Is(err, intake.ErrNotFound) {
		t.Fatalf("Latest before submit = %v", err)
	}
	draft := intake.Draft{
		Networks: []intake.Network{{Platform: intake.PlatformVK, URL: "https://vk.com/anna"}},
		Goals:    []string{"reach", "check"},
		Note:     "Без танцев",
	}
	first, updated, err := db.Submit(ctx, master.ID, draft, now)
	if err != nil || updated || first.Status != intake.StatusNew || len(first.Goals) != 2 || first.Networks[0].URL != "https://vk.com/anna" {
		t.Fatalf("first = %+v, updated %v, err %v", first, updated, err)
	}
	draft.Note = "Без танцев и трендов"
	second, updated, err := db.Submit(ctx, master.ID, draft, now.Add(time.Minute))
	if err != nil || !updated || second.ID != first.ID || second.Note != "Без танцев и трендов" {
		t.Fatalf("second = %+v, updated %v, err %v", second, updated, err)
	}

	pending, err := db.List(ctx, intake.StatusNew, 50)
	if err != nil || !contains(pending, first.ID) {
		t.Fatalf("pending = %+v, err %v", pending, err)
	}
	if err := db.Ready(ctx, master.ID, "План готов", now.Add(time.Hour)); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	latest, err := db.Latest(ctx, master.ID)
	if err != nil || latest.Status != intake.StatusReady || latest.ReplyNote != "План готов" || latest.ReadyAt.IsZero() {
		t.Fatalf("latest = %+v, err %v", latest, err)
	}
	next, updated, err := db.Submit(ctx, master.ID, draft, now.Add(2*time.Hour))
	if err != nil || updated || next.ID == first.ID {
		t.Fatalf("next = %+v, updated %v, err %v", next, updated, err)
	}
}

func contains(requests []intake.Request, id string) bool {
	for _, request := range requests {
		if request.ID == id {
			return true
		}
	}
	return false
}
