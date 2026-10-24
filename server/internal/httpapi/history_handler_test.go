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
	mu       sync.Mutex
	messages []store.Message
	events   []string
	errors   []string
}

func (f *fakeStore) SaveMessages(messages []store.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messages = append(f.messages, messages...)
}

func (f *fakeStore) SaveEvent(kind, _ string, _ any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, kind)
}

func (f *fakeStore) SaveError(source, message string, _ any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.errors = append(f.errors, source+": "+message)
}

func (f *fakeStore) Messages(_ context.Context, filter store.MessageFilter) ([]store.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var result []store.Message
	for _, m := range f.messages {
		if filter.ConversationID == "" || m.ConversationID == filter.ConversationID {
			result = append(result, m)
		}
	}
	return result, nil
}

func callStore(t *testing.T, history store.Store, method, path, body, password string) *httptest.ResponseRecorder {
	t.Helper()
	people := accounts.NewMemory()
	code, _ := auth.GenerateCode()
	_, _ = people.CreateMaster(context.Background(), "Анна", auth.HashCode(code))
	if !isAdminPath(path) {
		password = code
	}
	handler := bothHandlers(Options{
		AllowedOrigins: []string{testOrigin},
		Accounts:       people,
		Store:          history,
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if password != "" {
		request.Header.Set("Authorization", BearerPrefix+password)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestIngestStoresMessagesAndSkipsEmpty(t *testing.T) {
	history := &fakeStore{}
	body := `{"source":"claude-code","conversationId":"s1","messages":[
		{"externalId":"a","role":"user","text":"привет"},
		{"externalId":"b","role":"assistant","text":"   "},
		{"externalId":"c","role":"assistant","text":"здравствуйте"}]}`

	recorder := callStore(t, history, http.MethodPost, "/api/ingest", body, testPassword)

	if recorder.Code != http.StatusAccepted || !strings.Contains(recorder.Body.String(), `"accepted":2`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	if len(history.messages) != 2 || history.messages[0].Source != "claude-code" || history.messages[1].ExternalID != "c" {
		t.Fatalf("stored = %+v", history.messages)
	}
	if len(history.events) != 1 || history.events[0] != store.EventIngest {
		t.Fatalf("events = %v", history.events)
	}
}

func TestIngestRejectsBadBodies(t *testing.T) {
	for name, body := range map[string]string{
		"not json":    "garbage",
		"no source":   `{"messages":[{"role":"user","text":"x"}]}`,
		"no messages": `{"source":"claude-code","messages":[]}`,
	} {
		recorder := callStore(t, &fakeStore{}, http.MethodPost, "/api/ingest", body, testPassword)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d", name, recorder.Code)
		}
	}
}

func TestHistoryFiltersByConversation(t *testing.T) {
	history := &fakeStore{messages: []store.Message{
		{ConversationID: "one", Text: "a"},
		{ConversationID: "two", Text: "b"},
	}}

	recorder := callStore(t, history, http.MethodGet, "/api/history?conversation=two", "", testPassword)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"text":"b"`) || strings.Contains(recorder.Body.String(), `"text":"a"`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
}

func TestClientErrorIsStored(t *testing.T) {
	history := &fakeStore{}

	recorder := callStore(t, history, http.MethodPost, "/api/client-error", `{"message":"boom","where":"chat.ts","version":"1"}`, testPassword)
	empty := callStore(t, history, http.MethodPost, "/api/client-error", `{"message":"  "}`, testPassword)

	if recorder.Code != http.StatusNoContent || len(history.errors) != 1 || history.errors[0] != "client: boom" {
		t.Fatalf("status = %d, errors = %v", recorder.Code, history.errors)
	}
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty status = %d", empty.Code)
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
