package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/feedback"
)

type feedbackFixture struct {
	*accountFixture
	notifier *fakeNotifier
	messages *feedback.Memory
}

func newFeedbackFixture(t *testing.T) *feedbackFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	notifier := &fakeNotifier{reach: make(chan struct{}, 8)}
	messages := feedback.NewMemory()
	base.handler = bothHandlers(Options{
		Accounts:       base.store,
		Feedback:       messages,
		Notifier:       notifier,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &feedbackFixture{accountFixture: base, notifier: notifier, messages: messages}
}

func TestFeedbackIsSavedAndTheOwnerGetsTheAccountAndContact(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, err := auth.GenerateCode()
	if err != nil {
		t.Fatal(err)
	}
	master, err := fixture.store.RegisterIdentity(context.Background(), "Анна", auth.HashCode(code), accounts.ProviderYandex, "ya-1", "anna@yandex.ru")
	if err != nil {
		t.Fatal(err)
	}

	response := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Не приходит напоминание","contact":"@anna_nails"}`)
	sent := fixture.notifier.wait(t)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status %d %s", response.Code, response.Body)
	}
	for _, want := range []string{"Обратная связь", "Анна", "anna@yandex.ru", "@anna_nails", "Не приходит напоминание", master.ID} {
		if !strings.Contains(sent, want) {
			t.Errorf("notification lacks %q:\n%s", want, sent)
		}
	}
	saved, _ := fixture.messages.List(context.Background(), 10)
	if len(saved) != 1 || saved[0].MasterID != master.ID || saved[0].Text != "Не приходит напоминание" || saved[0].Contact != "@anna_nails" || saved[0].Email != "anna@yandex.ru" {
		t.Fatalf("saved = %+v", saved)
	}
}

func TestFeedbackRejectsBadInputAndAnonymous(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, _ := fixture.master(t, "Анна")
	cases := map[string]string{
		"empty text":   `{"text":"   "}`,
		"long text":    `{"text":"` + strings.Repeat("я", feedback.MaxTextRunes+1) + `"}`,
		"long contact": `{"text":"привет","contact":"` + strings.Repeat("я", feedback.MaxContactRunes+1) + `"}`,
		"not json":     `nope`,
	}
	for name, body := range cases {
		if response := fixture.call(http.MethodPost, "/api/feedback", code, body); response.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d %s", name, response.Code, response.Body)
		}
	}
	if got := fixture.call(http.MethodPost, "/api/feedback", "", `{"text":"привет"}`).Code; got != http.StatusUnauthorized {
		t.Errorf("anonymous status %d", got)
	}
	if saved, _ := fixture.messages.List(context.Background(), 10); len(saved) != 0 {
		t.Errorf("saved %d bad messages", len(saved))
	}
}

func TestFeedbackIsLimitedPerHour(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, _ := fixture.master(t, "Анна")

	for index := 0; index < feedback.MaxPerHour; index++ {
		if response := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"раз"}`); response.Code != http.StatusNoContent {
			t.Fatalf("message %d: status %d", index, response.Code)
		}
	}
	response := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"ещё"}`)

	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d %s", response.Code, response.Body)
	}
}

func TestFeedbackIsSavedEvenWithoutTelegram(t *testing.T) {
	fixture := newFeedbackFixture(t)
	fixture.handler = bothHandlers(Options{
		Accounts: fixture.store,
		Feedback: fixture.messages,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Привет"}`)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status %d %s", response.Code, response.Body)
	}
	if saved, _ := fixture.messages.List(context.Background(), 10); len(saved) != 1 {
		t.Fatalf("saved %d", len(saved))
	}
}

func TestTheOwnerListsFeedbackAndThePublicServerHasNoSuchRoute(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Привет, мир"}`)

	listed := fixture.call(http.MethodGet, "/api/admin/feedback", "", "")

	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), "Привет, мир") {
		t.Fatalf("list = %d %s", listed.Code, listed.Body)
	}
	public := NewHandler(Options{Accounts: fixture.store, Feedback: fixture.messages, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	request, _ := http.NewRequest(http.MethodGet, "/api/admin/feedback", nil)
	recorder := httptest.NewRecorder()
	public.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Errorf("public admin route status %d", recorder.Code)
	}
}
