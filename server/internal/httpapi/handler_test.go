package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	testPassword = "secret-pass"
	testOrigin   = "https://starcevalexander.github.io"
)

func isAdminPath(path string) bool {
	for _, prefix := range []string{"/api/admin/", "/api/agent/", "/api/history", "/api/events", "/api/errors", "/api/ingest"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func bothHandlers(options Options) http.Handler {
	public := NewHandler(options)
	admin := NewAdminHandler(options)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAdminPath(r.URL.Path) {
			admin.ServeHTTP(w, r)
			return
		}
		public.ServeHTTP(w, r)
	})
}

func newTestHandler() http.Handler {
	return bothHandlers(Options{
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func TestCORSPreflight(t *testing.T) {
	handler := newTestHandler()

	t.Run("allowed origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodOptions, "/api/state", nil)
		request.Header.Set("Origin", testOrigin)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNoContent {
			t.Fatalf("status = %d", recorder.Code)
		}
		if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
			t.Errorf("allow-origin = %q", got)
		}
		if got := recorder.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Authorization") {
			t.Errorf("allow-headers = %q", got)
		}
	})

	t.Run("foreign origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodOptions, "/api/state", nil)
		request.Header.Set("Origin", "https://evil.example")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("allow-origin = %q, want empty", got)
		}
	})
}

func TestCORSHeaderOnResponse(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("Authorization", BearerPrefix+testPassword)
	request.Header.Set("Origin", testOrigin)
	recorder := httptest.NewRecorder()
	newTestHandler().ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
		t.Errorf("allow-origin = %q", got)
	}
}

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	newTestHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusNoContent {
		t.Errorf("status = %d", recorder.Code)
	}
}
