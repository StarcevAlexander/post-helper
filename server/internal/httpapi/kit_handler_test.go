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

	"post-helper/server/internal/kit"
)

type fakeKitMaker struct {
	result   kit.Kit
	err      error
	requests []kit.Request
}

func (f *fakeKitMaker) Generate(_ context.Context, request kit.Request) (kit.Kit, error) {
	f.requests = append(f.requests, request)
	return f.result, f.err
}

func postKit(t *testing.T, maker kit.Generator, password, body string) *httptest.ResponseRecorder {
	t.Helper()
	handler := NewHandler(Options{
		Responder:      &fakeResponder{},
		KitMaker:       maker,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "/api/kit", strings.NewReader(body))
	if password != "" {
		request.Header.Set("Authorization", BearerPrefix+password)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

const validKitBody = `{"profile":{"specialty":"  маникюр "},"positioning":" Аккуратный ","format":"reels","pillar":"Процесс","idea":" Видео снятия гель-лака "}`

func TestKit(t *testing.T) {
	maker := &fakeKitMaker{result: kit.Kit{
		Shots:    []string{"Снять руки"},
		Frames:   []kit.Frame{{Visual: "Руки", Overlay: "Смотрите"}},
		Caption:  "Подпись",
		Hashtags: []string{"#маникюр"},
	}}

	recorder := postKit(t, maker, testPassword, validKitBody)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	for _, want := range []string{`"caption":"Подпись"`, `"hashtags":["#маникюр"]`, `"visual":"Руки"`} {
		if !strings.Contains(recorder.Body.String(), want) {
			t.Errorf("body %s lacks %s", recorder.Body, want)
		}
	}
	if len(maker.requests) != 1 {
		t.Fatalf("requests = %d", len(maker.requests))
	}
	got := maker.requests[0]
	if got.Profile.Specialty != "маникюр" || got.Idea != "Видео снятия гель-лака" || got.Positioning != "Аккуратный" || got.Format != "reels" {
		t.Errorf("request = %+v", got)
	}
}

func TestKitRejections(t *testing.T) {
	long := strings.Repeat("я", MaxKitFieldRunes+1)
	tests := []struct {
		name       string
		maker      kit.Generator
		password   string
		body       string
		wantStatus int
	}{
		{name: "no password", maker: &fakeKitMaker{}, body: validKitBody, wantStatus: http.StatusUnauthorized},
		{name: "bad json", maker: &fakeKitMaker{}, password: testPassword, body: `nope`, wantStatus: http.StatusBadRequest},
		{name: "unknown format", maker: &fakeKitMaker{}, password: testPassword, body: `{"profile":{"specialty":"x"},"format":"tiktok","idea":"y"}`, wantStatus: http.StatusBadRequest},
		{name: "no idea", maker: &fakeKitMaker{}, password: testPassword, body: `{"profile":{"specialty":"x"},"format":"post","idea":"  "}`, wantStatus: http.StatusBadRequest},
		{name: "no specialty", maker: &fakeKitMaker{}, password: testPassword, body: `{"profile":{"specialty":" "},"format":"post","idea":"y"}`, wantStatus: http.StatusBadRequest},
		{name: "idea too long", maker: &fakeKitMaker{}, password: testPassword, body: `{"profile":{"specialty":"x"},"format":"post","idea":"` + long + `"}`, wantStatus: http.StatusBadRequest},
		{name: "refused", maker: &fakeKitMaker{err: kit.ErrRefused}, password: testPassword, body: validKitBody, wantStatus: http.StatusUnprocessableEntity},
		{name: "generator fails", maker: &fakeKitMaker{err: errors.New("boom")}, password: testPassword, body: validKitBody, wantStatus: http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := postKit(t, tt.maker, tt.password, tt.body)
			if recorder.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", recorder.Code, tt.wantStatus, recorder.Body)
			}
		})
	}
}
