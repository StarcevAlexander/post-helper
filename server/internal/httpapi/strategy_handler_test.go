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

	"post-helper/server/internal/strategy"
)

type fakeStrategist struct {
	result   strategy.Strategy
	err      error
	profiles []strategy.Profile
}

func (f *fakeStrategist) Generate(_ context.Context, profile strategy.Profile) (strategy.Strategy, error) {
	f.profiles = append(f.profiles, profile)
	return f.result, f.err
}

func postStrategy(t *testing.T, generator strategy.Generator, password, body string) *httptest.ResponseRecorder {
	t.Helper()
	handler := NewHandler(Options{
		Responder:      &fakeResponder{},
		Strategist:     generator,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "/api/strategy", strings.NewReader(body))
	if password != "" {
		request.Header.Set("Authorization", BearerPrefix+password)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestStrategy(t *testing.T) {
	generator := &fakeStrategist{result: strategy.Strategy{Summary: "Ок", Pillars: []strategy.Pillar{{Title: "До и после"}}}}

	recorder := postStrategy(t, generator, testPassword, `{"specialty":"  маникюр ","city":"Иркутск"}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	if !strings.Contains(recorder.Body.String(), `"summary":"Ок"`) {
		t.Errorf("body = %s", recorder.Body)
	}
	if len(generator.profiles) != 1 || generator.profiles[0].Specialty != "маникюр" || generator.profiles[0].City != "Иркутск" {
		t.Errorf("profiles = %+v", generator.profiles)
	}
}

func TestStrategyRejections(t *testing.T) {
	long := strings.Repeat("я", MaxProfileFieldRunes+1)
	tests := []struct {
		name       string
		generator  strategy.Generator
		password   string
		body       string
		wantStatus int
	}{
		{name: "no password", generator: &fakeStrategist{}, body: `{"specialty":"x"}`, wantStatus: http.StatusUnauthorized},
		{name: "bad json", generator: &fakeStrategist{}, password: testPassword, body: `nope`, wantStatus: http.StatusBadRequest},
		{name: "no specialty", generator: &fakeStrategist{}, password: testPassword, body: `{"specialty":"  ","city":"Иркутск"}`, wantStatus: http.StatusBadRequest},
		{name: "too long", generator: &fakeStrategist{}, password: testPassword, body: `{"specialty":"x","goal":"` + long + `"}`, wantStatus: http.StatusBadRequest},
		{name: "insufficient", generator: &fakeStrategist{err: &strategy.InsufficientError{Reason: "Непонятно"}}, password: testPassword, body: `{"specialty":"x"}`, wantStatus: http.StatusUnprocessableEntity},
		{name: "refused", generator: &fakeStrategist{err: strategy.ErrRefused}, password: testPassword, body: `{"specialty":"x"}`, wantStatus: http.StatusUnprocessableEntity},
		{name: "generator fails", generator: &fakeStrategist{err: errors.New("boom")}, password: testPassword, body: `{"specialty":"x"}`, wantStatus: http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := postStrategy(t, tt.generator, tt.password, tt.body)
			if recorder.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", recorder.Code, tt.wantStatus, recorder.Body)
			}
		})
	}
}
