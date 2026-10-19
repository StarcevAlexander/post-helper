package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/audit"
)

type fakeAuditor struct {
	result   audit.Result
	err      error
	requests []audit.Request
}

func (f *fakeAuditor) Generate(_ context.Context, request audit.Request) (audit.Result, error) {
	f.requests = append(f.requests, request)
	return f.result, f.err
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R'}

type auditFile struct {
	name string
	data []byte
}

func pngFiles(count int) []auditFile {
	files := make([]auditFile, count)
	for i := range files {
		files[i] = auditFile{name: "shot.png", data: pngSignature}
	}
	return files
}

func postAudit(t *testing.T, auditor audit.Generator, token, profile string, files []auditFile) *httptest.ResponseRecorder {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if profile != "" {
		if err := writer.WriteField(FieldProfile, profile); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range files {
		part, err := writer.CreateFormFile(FieldImages, file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(file.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	handler := NewHandler(Options{
		Responder:      &fakeResponder{},
		Auditor:        auditor,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "/api/audit", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

const auditProfile = `{"specialty":" маникюр ","city":"Иркутск"}`

func TestAudit(t *testing.T) {
	auditor := &fakeAuditor{result: audit.Result{Summary: "Итог", Fixes: []string{"Правка"}}}

	recorder := postAudit(t, auditor, testPassword, auditProfile, pngFiles(3))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	if !strings.Contains(recorder.Body.String(), `"summary":"Итог"`) || !strings.Contains(recorder.Body.String(), `"fixes":["Правка"]`) {
		t.Errorf("body = %s", recorder.Body)
	}
	got := auditor.requests[0]
	if got.Profile.Specialty != "маникюр" || len(got.Images) != 3 || got.Images[0].MediaType != "image/png" {
		t.Errorf("request = %+v", got)
	}
}

func TestAuditRejections(t *testing.T) {
	big := bytes.Repeat([]byte{'x'}, audit.MaxImageBytes+10)
	big = append(append([]byte{}, pngSignature...), big...)
	tests := []struct {
		name    string
		auditor audit.Generator
		token   string
		profile string
		files   []auditFile
		want    int
	}{
		{name: "no login", auditor: &fakeAuditor{}, token: "", profile: auditProfile, files: pngFiles(1), want: http.StatusUnauthorized},
		{name: "no profile", auditor: &fakeAuditor{}, token: testPassword, profile: "", files: pngFiles(1), want: http.StatusBadRequest},
		{name: "bad profile json", auditor: &fakeAuditor{}, token: testPassword, profile: "{", files: pngFiles(1), want: http.StatusBadRequest},
		{name: "no specialty", auditor: &fakeAuditor{}, token: testPassword, profile: `{"specialty":" "}`, files: pngFiles(1), want: http.StatusBadRequest},
		{name: "no images", auditor: &fakeAuditor{}, token: testPassword, profile: auditProfile, want: http.StatusBadRequest},
		{name: "too many images", auditor: &fakeAuditor{}, token: testPassword, profile: auditProfile, files: pngFiles(audit.MaxImages + 1), want: http.StatusBadRequest},
		{name: "not an image", auditor: &fakeAuditor{}, token: testPassword, profile: auditProfile, files: []auditFile{{name: "a.txt", data: []byte("просто текст")}}, want: http.StatusUnsupportedMediaType},
		{name: "pdf", auditor: &fakeAuditor{}, token: testPassword, profile: auditProfile, files: []auditFile{{name: "a.pdf", data: []byte("%PDF-1.4 test")}}, want: http.StatusUnsupportedMediaType},
		{name: "image too large", auditor: &fakeAuditor{}, token: testPassword, profile: auditProfile, files: []auditFile{{name: "big.png", data: big}}, want: http.StatusRequestEntityTooLarge},
		{name: "unreadable", auditor: &fakeAuditor{err: &audit.UnreadableError{Reason: "Слишком тёмные"}}, token: testPassword, profile: auditProfile, files: pngFiles(1), want: http.StatusUnprocessableEntity},
		{name: "refused", auditor: &fakeAuditor{err: audit.ErrRefused}, token: testPassword, profile: auditProfile, files: pngFiles(1), want: http.StatusUnprocessableEntity},
		{name: "generator fails", auditor: &fakeAuditor{err: errors.New("boom")}, token: testPassword, profile: auditProfile, files: pngFiles(1), want: http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := postAudit(t, tt.auditor, tt.token, tt.profile, tt.files)
			if recorder.Code != tt.want {
				t.Errorf("status = %d, want %d, body = %s", recorder.Code, tt.want, recorder.Body)
			}
		})
	}
}

func TestAuditExplainsUnreadableScreenshots(t *testing.T) {
	recorder := postAudit(t, &fakeAuditor{err: &audit.UnreadableError{Reason: "Слишком тёмные, переснимите"}}, testPassword, auditProfile, pngFiles(1))

	if !strings.Contains(recorder.Body.String(), "Слишком тёмные, переснимите") {
		t.Errorf("body = %s", recorder.Body)
	}
}

func TestAuditCountsAgainstTheDailyLimit(t *testing.T) {
	fixture := newAccountFixture(t, 1)
	code, _ := fixture.master(t, "Анна")
	auditor := &fakeAuditor{result: audit.Result{Summary: "Итог", Fixes: []string{"x"}}}
	call := func() int {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField(FieldProfile, auditProfile)
		part, _ := writer.CreateFormFile(FieldImages, "a.png")
		_, _ = part.Write(pngSignature)
		_ = writer.Close()
		handler := NewHandler(Options{
			Responder:      &fakeResponder{},
			Auditor:        auditor,
			Accounts:       fixture.store,
			DailyAILimit:   1,
			Password:       testPassword,
			AllowedOrigins: []string{testOrigin},
			Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		})
		request := httptest.NewRequest(http.MethodPost, "/api/audit", body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		request.Header.Set("Authorization", BearerPrefix+code)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Code
	}

	if first := call(); first != http.StatusOK {
		t.Fatalf("first = %d", first)
	}
	if second := call(); second != http.StatusTooManyRequests {
		t.Errorf("second = %d, want 429", second)
	}
}
