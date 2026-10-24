package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
)

func shutdownHandler(shutdown func()) (http.Handler, string) {
	store := accounts.NewMemory()
	code, _ := auth.GenerateCode()
	_, _ = store.CreateMaster(context.Background(), "Анна", auth.HashCode(code))
	return bothHandlers(Options{
		Accounts: store,
		Shutdown: shutdown,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}), code
}

func callShutdown(handler http.Handler, token string) int {
	request := httptest.NewRequest(http.MethodPost, "/api/admin/shutdown", strings.NewReader(""))
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func TestShutdownRouteIsOffByDefault(t *testing.T) {
	handler, _ := shutdownHandler(nil)

	if got := callShutdown(handler, ""); got != http.StatusNotFound {
		t.Errorf("status = %d", got)
	}
}

func TestThePublicHandlerHasNoAdminRoutesAtAll(t *testing.T) {
	store := accounts.NewMemory()
	code, _ := auth.GenerateCode()
	master, _ := store.CreateMaster(context.Background(), "Анна", auth.HashCode(code))
	called := make(chan struct{}, 1)
	public := NewHandler(Options{
		Accounts: store,
		Shutdown: func() { called <- struct{}{} },
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	routes := []struct{ method, path string }{
		{http.MethodPost, "/api/admin/shutdown"},
		{http.MethodGet, "/api/admin/masters"},
		{http.MethodPost, "/api/admin/masters"},
		{http.MethodPost, "/api/admin/masters/" + master.ID + "/plan"},
		{http.MethodDelete, "/api/admin/masters/" + master.ID},
		{http.MethodGet, "/api/admin/intakes"},
		{http.MethodGet, "/api/agent/jobs/next"},
		{http.MethodGet, "/api/agent/refs/next"},
		{http.MethodGet, "/api/history"},
		{http.MethodGet, "/api/events"},
		{http.MethodGet, "/api/errors"},
		{http.MethodPost, "/api/ingest"},
	}
	for _, route := range routes {
		for name, token := range map[string]string{"stranger": "", "master": code} {
			request := httptest.NewRequest(route.method, route.path, strings.NewReader("{}"))
			if token != "" {
				request.Header.Set("Authorization", BearerPrefix+token)
			}
			recorder := httptest.NewRecorder()
			public.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s as %s: status = %d, the public port must not know this route", route.method, route.path, name, recorder.Code)
			}
		}
	}
	select {
	case <-called:
		t.Fatal("shutdown ran through the public handler")
	case <-time.After(2 * ShutdownDelay):
	}
}

func TestShutdownRunsAfterTheAnswer(t *testing.T) {
	called := make(chan struct{}, 1)
	handler, _ := shutdownHandler(func() { called <- struct{}{} })

	if got := callShutdown(handler, ""); got != http.StatusOK {
		t.Fatalf("status = %d", got)
	}
	select {
	case <-called:
	case <-time.After(5 * ShutdownDelay):
		t.Fatal("shutdown never ran")
	}
}
