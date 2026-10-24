package feedback_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/store"
)

func TestCleanTrimsAndChecksLimits(t *testing.T) {
	text, contact, err := feedback.Clean("  Привет  ", "  @anna ")
	if err != nil || text != "Привет" || contact != "@anna" {
		t.Fatalf("Clean = %q %q %v", text, contact, err)
	}
	if _, _, err := feedback.Clean("  ", ""); !errors.Is(err, feedback.ErrEmptyText) {
		t.Errorf("empty = %v", err)
	}
	if _, _, err := feedback.Clean(strings.Repeat("я", feedback.MaxTextRunes+1), ""); !errors.Is(err, feedback.ErrLongText) {
		t.Errorf("long text = %v", err)
	}
	if _, _, err := feedback.Clean("ок", strings.Repeat("я", feedback.MaxContactRunes+1)); !errors.Is(err, feedback.ErrLongContact) {
		t.Errorf("long contact = %v", err)
	}
	if _, _, err := feedback.Clean(strings.Repeat("я", feedback.MaxTextRunes), ""); err != nil {
		t.Errorf("text at the limit = %v", err)
	}
}

func TestAnnouncementNamesTheAccountAndTheContact(t *testing.T) {
	text := feedback.Announcement(feedback.Message{MasterID: "m1", MasterName: "Анна", Email: "a@ya.ru", Contact: "+7 900", Text: "Помогите"})

	for _, want := range []string{"Анна", "a@ya.ru", "+7 900", "Помогите", "m1"} {
		if !strings.Contains(text, want) {
			t.Errorf("announcement lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(feedback.Announcement(feedback.Message{MasterName: "Анна", Text: "x"}), "Контакт") {
		t.Error("announcement shows an empty contact")
	}
}

func TestPostgresFeedbackLifecycle(t *testing.T) {
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
	db := feedback.NewPostgres(postgres.Pool())
	now := time.Now()
	master, err := people.CreateMaster(ctx, "Тест обратной связи", "feedback-hash-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })

	id, _ := feedback.NewID()
	if _, err := db.Add(ctx, feedback.Message{ID: id, MasterID: master.ID, MasterName: master.Name, Contact: "@test", Text: "Проверка", CreatedAt: now}); err != nil {
		t.Fatalf("add: %v", err)
	}
	count, err := db.CountSince(ctx, master.ID, now.Add(-time.Minute))
	if err != nil || count != 1 {
		t.Fatalf("count = %d, %v", count, err)
	}
	listed, err := db.List(ctx, 50)
	if err != nil || len(listed) == 0 || listed[0].Text != "Проверка" || listed[0].Contact != "@test" {
		t.Fatalf("list = %+v, %v", listed, err)
	}
}
