package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/store"
)

type fakeStore struct {
	store.Noop
	mu     sync.Mutex
	errors []string
}

func (f *fakeStore) SaveError(source, message string, _ any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.errors = append(f.errors, source+": "+message)
}

type clientErrorFixture struct {
	handler http.Handler
	history *fakeStore
	store   *accounts.Memory
}

func newClientErrorFixture(t *testing.T) *clientErrorFixture {
	t.Helper()
	fixture := &clientErrorFixture{history: &fakeStore{}, store: accounts.NewMemory()}
	fixture.handler = bothHandlers(Options{
		AllowedOrigins: []string{testOrigin},
		Accounts:       fixture.store,
		Store:          fixture.history,
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return fixture
}

func (f *clientErrorFixture) master(t *testing.T, name string) string {
	t.Helper()
	code, _ := auth.GenerateCode()
	if _, err := f.store.CreateMaster(context.Background(), name, auth.HashCode(code)); err != nil {
		t.Fatal(err)
	}
	return code
}

func (f *clientErrorFixture) report(token, body string) int {
	request := httptest.NewRequest(http.MethodPost, "/api/client-error", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func TestClientErrorIsStored(t *testing.T) {
	fixture := newClientErrorFixture(t)
	code := fixture.master(t, "Анна")

	stored := fixture.report(code, `{"message":"boom","where":"chat.ts","version":"1"}`)
	empty := fixture.report(code, `{"message":"  "}`)
	anonymous := fixture.report("", `{"message":"boom"}`)

	if stored != http.StatusNoContent || len(fixture.history.errors) != 1 || fixture.history.errors[0] != "client: boom" {
		t.Fatalf("status = %d, errors = %v", stored, fixture.history.errors)
	}
	if empty != http.StatusBadRequest || anonymous != http.StatusUnauthorized {
		t.Fatalf("empty = %d, anonymous = %d", empty, anonymous)
	}
}

func TestClientErrorsAreLimitedPerMaster(t *testing.T) {
	fixture := newClientErrorFixture(t)
	anna := fixture.master(t, "Анна")
	vera := fixture.master(t, "Вера")

	var last int
	for range ClientErrorLimitPerWindow + 1 {
		last = fixture.report(anna, `{"message":"boom"}`)
	}

	if last != http.StatusTooManyRequests {
		t.Errorf("last status for the noisy master = %d", last)
	}
	if got := fixture.report(vera, `{"message":"boom"}`); got != http.StatusNoContent {
		t.Errorf("another master must not be limited, got %d", got)
	}
	if len(fixture.history.errors) != ClientErrorLimitPerWindow+1 {
		t.Errorf("stored = %d, want %d", len(fixture.history.errors), ClientErrorLimitPerWindow+1)
	}
}

func TestPanicIsRecoveredAndLogged(t *testing.T) {
	history := &fakeStore{}
	logger := slog.New(store.NewErrorHandler(slog.NewTextHandler(io.Discard, nil), history))
	handler := withRecover(logger, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("kaboom") }))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/x", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", recorder.Code)
	}
	if len(history.errors) != 1 || !strings.Contains(history.errors[0], "panic in handler") {
		t.Fatalf("errors = %v", history.errors)
	}
}
