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
	return NewHandler(Options{
		Accounts: store,
		Password: testPassword,
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

	if got := callShutdown(handler, testPassword); got != http.StatusNotFound {
		t.Errorf("status = %d", got)
	}
}

func TestShutdownIsForTheOwnerOnly(t *testing.T) {
	called := make(chan struct{}, 1)
	handler, masterCode := shutdownHandler(func() { called <- struct{}{} })

	for name, token := range map[string]string{"no token": "", "wrong": "wrong", "master": masterCode} {
		if got := callShutdown(handler, token); got == http.StatusOK {
			t.Errorf("%s was allowed to shut the server down", name)
		}
	}
	select {
	case <-called:
		t.Fatal("shutdown ran for a refused caller")
	case <-time.After(2 * ShutdownDelay):
	}
}

func TestOwnerShutdownRunsAfterTheAnswer(t *testing.T) {
	called := make(chan struct{}, 1)
	handler, _ := shutdownHandler(func() { called <- struct{}{} })

	if got := callShutdown(handler, testPassword); got != http.StatusOK {
		t.Fatalf("status = %d", got)
	}
	select {
	case <-called:
	case <-time.After(5 * ShutdownDelay):
		t.Fatal("shutdown never ran")
	}
}
