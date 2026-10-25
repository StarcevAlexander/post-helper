package intake

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMemoryResubmitUpdatesPendingRequest(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	draft := Draft{Networks: []Network{{Platform: PlatformVK, URL: "https://vk.com/anna"}}, Goals: []string{"reach"}}

	first, updated, err := store.Submit(ctx, "m1", draft, now)
	if err != nil || updated {
		t.Fatalf("first submit = %v, updated %v", err, updated)
	}
	draft.Note = "Добавила пожелание"
	second, updated, err := store.Submit(ctx, "m1", draft, now.Add(time.Minute))

	if err != nil || !updated || second.ID != first.ID || second.Note != "Добавила пожелание" {
		t.Fatalf("second = %+v, updated %v, err %v", second, updated, err)
	}
}

func TestMemoryNewRequestAfterReady(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	draft := Draft{Networks: []Network{{Platform: PlatformVK, URL: "https://vk.com/anna"}}, Goals: []string{"reach"}}
	first, _, _ := store.Submit(ctx, "m1", draft, now)

	if err := store.Ready(ctx, "m1", "План готов", now.Add(time.Hour)); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	latest, _ := store.Latest(ctx, "m1")
	next, updated, _ := store.Submit(ctx, "m1", draft, now.Add(2*time.Hour))

	if latest.Status != StatusReady || latest.ReplyNote != "План готов" || latest.ReadyAt.IsZero() {
		t.Errorf("latest = %+v", latest)
	}
	if updated || next.ID == first.ID || next.Status != StatusNew {
		t.Errorf("next = %+v, updated %v", next, updated)
	}
	pending, _ := store.List(ctx, StatusNew, 10)
	if len(pending) != 1 || pending[0].ID != next.ID {
		t.Errorf("pending = %+v", pending)
	}
}

func TestMemoryLatestAndReadyWithoutRequest(t *testing.T) {
	store := NewMemory()
	if _, err := store.Latest(context.Background(), "nobody"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Latest err = %v", err)
	}
	if err := store.Ready(context.Background(), "nobody", "", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Errorf("Ready err = %v", err)
	}
}

func TestTelegramSendsMessage(t *testing.T) {
	var path, chat, text string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		path, chat, text = r.URL.Path, r.PostForm.Get("chat_id"), r.PostForm.Get("text")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := NewTelegram("123:abc", "555").WithBaseURL(server.URL).Notify(context.Background(), "привет")

	if err != nil || path != "/bot123:abc/sendMessage" || chat != "555" || text != "привет" {
		t.Errorf("err %v, path %q, chat %q, text %q", err, path, chat, text)
	}
}

func TestTelegramErrorDoesNotLeakToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad", http.StatusUnauthorized)
	}))
	server.Close()

	err := NewTelegram("123:secret", "555").WithBaseURL(server.URL).Notify(context.Background(), "x")

	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Errorf("err = %v", err)
	}
}

func TestTelegramDisabledWithoutSettings(t *testing.T) {
	if NewTelegram("", "555") != nil || NewTelegram("123:abc", "") != nil {
		t.Error("expected nil notifier")
	}
}

func TestMemoryRemembersThatTheMasterAsksForTheMonthReview(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	draft := Draft{Networks: []Network{{Platform: PlatformVK, URL: "https://vk.com/anna"}}, Goals: []string{"reach"}}
	_, _, _ = store.Submit(ctx, "m1", draft, now)
	_ = store.Ready(ctx, "m1", "План готов", now.Add(time.Hour))

	draft.Review = true
	review, updated, err := store.Submit(ctx, "m1", draft, now.Add(24*time.Hour))

	if err != nil || updated || !review.Review {
		t.Fatalf("review = %+v, updated %v, err %v", review, updated, err)
	}
	listed, _ := store.List(ctx, StatusNew, 10)
	if len(listed) != 1 || !listed[0].Review {
		t.Fatalf("listed = %+v", listed)
	}
}

func TestMemoryReadyOnlyFlipsNewRequests(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	draft := Draft{Networks: []Network{{Platform: PlatformVK, URL: "https://vk.com/anna"}}, Goals: []string{"reach"}}
	_, _, _ = store.Submit(ctx, "m1", draft, now)
	if err := store.Ready(ctx, "m1", "План готов", now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	if err := store.Ready(ctx, "m1", "", now.Add(2*time.Hour)); err != nil {
		t.Fatalf("second Ready: %v", err)
	}

	latest, _ := store.Latest(ctx, "m1")
	if latest.Status != StatusReady || latest.ReplyNote != "План готов" || !latest.ReadyAt.Equal(now.Add(time.Hour)) {
		t.Errorf("a ready request must stay untouched, got %+v", latest)
	}
}
