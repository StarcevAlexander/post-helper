package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/accounts"
)

const (
	testPassword  = "secret-pass"
	testOrigin    = "https://starcevalexander.github.io"
	testAdminHost = "127.0.0.1:8081"
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
			r.Host = testAdminHost
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

func TestAdminPortRejectsBrowserAndForeignHosts(t *testing.T) {
	admin := NewAdminHandler(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	tests := []struct {
		name    string
		path    string
		host    string
		headers map[string]string
		want    int
	}{
		{"script on loopback", "/api/admin/masters", "127.0.0.1:8081", nil, http.StatusOK},
		{"script on localhost", "/api/admin/masters", "localhost:8081", nil, http.StatusOK},
		{"script on v6", "/api/admin/masters", "[::1]:8081", nil, http.StatusOK},
		{"no port", "/api/admin/masters", "127.0.0.1", nil, http.StatusOK},
		{"fetch site none", "/api/admin/masters", "localhost:8081", map[string]string{"Sec-Fetch-Site": "none"}, http.StatusOK},
		{"origin header", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Origin": testOrigin}, http.StatusForbidden},
		{"null origin", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Origin": "null"}, http.StatusForbidden},
		{"empty origin header", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Origin": ""}, http.StatusForbidden},
		{"cross site", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"same site", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Sec-Fetch-Site": "same-site"}, http.StatusForbidden},
		{"admin page reads its own data", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Sec-Fetch-Site": "same-origin"}, http.StatusOK},
		{"admin page with a same origin header", "/api/admin/masters", "127.0.0.1:8081", map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": "http://127.0.0.1:8081"}, http.StatusOK},
		{"the page itself opens from a link", "/admin/", "127.0.0.1:8081", map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusOK},
		{"the page never opens on a foreign host", "/admin/", "evil.example:8081", nil, http.StatusForbidden},
		{"same origin on a foreign host", "/api/admin/masters", "evil.example:8081", map[string]string{"Sec-Fetch-Site": "same-origin"}, http.StatusForbidden},
		{"rebinding host", "/api/admin/masters", "evil.example:8081", nil, http.StatusForbidden},
		{"lookalike host", "/api/admin/masters", "127.0.0.1.evil.example", nil, http.StatusForbidden},
		{"health stays open", "/healthz", "evil.example", nil, http.StatusNoContent},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			request.Host = tt.host
			for key, value := range tt.headers {
				request.Header[key] = []string{value}
			}
			recorder := httptest.NewRecorder()
			admin.ServeHTTP(recorder, request)
			if recorder.Code != tt.want {
				t.Errorf("status = %d, want %d", recorder.Code, tt.want)
			}
		})
	}
}

func TestTheAdminPageCannotChangeAnything(t *testing.T) {
	admin := NewAdminHandler(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	request := httptest.NewRequest(http.MethodPost, "/api/admin/masters", strings.NewReader(`{"name":"x"}`))
	request.Host = "127.0.0.1:8081"
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	recorder := httptest.NewRecorder()

	admin.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("same origin write = %d", recorder.Code)
	}
}

type brokenLookupStore struct {
	*accounts.Memory
	err error
}

func (b brokenLookupStore) FindByCodeHash(context.Context, string) (accounts.Master, error) {
	return accounts.Master{}, b.err
}

func TestAuthMiddlewareStatusByFailureKind(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{"unknown token", accounts.ErrNotFound, http.StatusUnauthorized},
		{"store down", errors.New("connection refused"), http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := NewHandler(Options{
				Accounts: brokenLookupStore{Memory: accounts.NewMemory(), err: tt.err},
				Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
			})
			request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
			request.Header.Set("Authorization", BearerPrefix+"ABCDE-FGHJK-LMNPQ-RSTUV")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != tt.want {
				t.Errorf("status = %d, want %d", recorder.Code, tt.want)
			}
		})
	}
}
