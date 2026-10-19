package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/chat"
)

const (
	testPassword = "secret-pass"
	testOrigin   = "https://starcevalexander.github.io"
)

type fakeResponder struct {
	reply        string
	err          error
	conversation chat.Conversation
	calls        int
}

func (f *fakeResponder) Reply(_ context.Context, conversation chat.Conversation) (string, error) {
	f.calls++
	f.conversation = conversation
	return f.reply, f.err
}

func newTestHandler(responder chat.Responder) http.Handler {
	return NewHandler(Options{
		Responder:      responder,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

type formFile struct {
	name string
	data []byte
}

func numberedFiles(count int) []formFile {
	files := make([]formFile, count)
	for i := range files {
		files[i] = formFile{name: fmt.Sprintf("file-%d.txt", i), data: []byte("текст")}
	}
	return files
}

func buildForm(t *testing.T, fields map[string]string, files []formFile) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write field: %v", err)
		}
	}
	for _, file := range files {
		part, err := writer.CreateFormFile(FieldFiles, file.name)
		if err != nil {
			t.Fatalf("create file: %v", err)
		}
		if _, err := part.Write(file.data); err != nil {
			t.Fatalf("write file: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return body, writer.FormDataContentType()
}

func postChat(t *testing.T, handler http.Handler, password string, fields map[string]string, files []formFile) *httptest.ResponseRecorder {
	t.Helper()
	body, contentType := buildForm(t, fields, files)
	request := httptest.NewRequest(http.MethodPost, "/api/chat", body)
	request.Header.Set("Content-Type", contentType)
	if password != "" {
		request.Header.Set("Authorization", BearerPrefix+password)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestChatSuccess(t *testing.T) {
	responder := &fakeResponder{reply: "Делайте так."}
	history := `[{"role":"user","text":"привет"},{"role":"assistant","text":"здравствуйте"}]`

	recorder := postChat(t, newTestHandler(responder), testPassword,
		map[string]string{FieldText: "  что делать?  ", FieldHistory: history},
		[]formFile{{name: "notes.txt", data: []byte("заметки")}},
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	var response ReplyResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if response.Reply != "Делайте так." {
		t.Errorf("reply = %q", response.Reply)
	}
	if responder.conversation.Text != "что делать?" {
		t.Errorf("text = %q", responder.conversation.Text)
	}
	if len(responder.conversation.History) != 2 {
		t.Errorf("history = %d", len(responder.conversation.History))
	}
	if len(responder.conversation.Attachments) != 1 || responder.conversation.Attachments[0].Name != "notes.txt" {
		t.Errorf("attachments = %+v", responder.conversation.Attachments)
	}
}

func TestChatRejections(t *testing.T) {
	tests := []struct {
		name       string
		password   string
		fields     map[string]string
		files      []formFile
		responder  *fakeResponder
		wantStatus int
		wantCalls  int
	}{
		{name: "no password", password: "", fields: map[string]string{FieldText: "q"}, wantStatus: http.StatusUnauthorized},
		{name: "wrong password", password: "nope", fields: map[string]string{FieldText: "q"}, wantStatus: http.StatusUnauthorized},
		{name: "empty message", password: testPassword, fields: map[string]string{FieldText: "  "}, wantStatus: http.StatusBadRequest},
		{name: "bad history", password: testPassword, fields: map[string]string{FieldText: "q", FieldHistory: "{"}, wantStatus: http.StatusBadRequest},
		{
			name:       "too many files",
			password:   testPassword,
			fields:     map[string]string{FieldText: "q"},
			files:      numberedFiles(MaxFiles + 1),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "unsupported attachment",
			password:   testPassword,
			fields:     map[string]string{FieldText: "q"},
			responder:  &fakeResponder{err: chat.ErrUnsupportedAttachment},
			wantStatus: http.StatusUnsupportedMediaType,
			wantCalls:  1,
		},
		{
			name:       "upstream failure",
			password:   testPassword,
			fields:     map[string]string{FieldText: "q"},
			responder:  &fakeResponder{err: errors.New("boom")},
			wantStatus: http.StatusBadGateway,
			wantCalls:  1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			responder := tt.responder
			if responder == nil {
				responder = &fakeResponder{reply: "ok"}
			}
			recorder := postChat(t, newTestHandler(responder), tt.password, tt.fields, tt.files)
			if recorder.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", recorder.Code, tt.wantStatus, recorder.Body)
			}
			if responder.calls != tt.wantCalls {
				t.Errorf("calls = %d, want %d", responder.calls, tt.wantCalls)
			}
			if tt.wantStatus >= http.StatusBadRequest && strings.Contains(recorder.Body.String(), "boom") {
				t.Errorf("internal error leaked: %s", recorder.Body)
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	handler := newTestHandler(&fakeResponder{})

	t.Run("allowed origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodOptions, "/api/chat", nil)
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
		request := httptest.NewRequest(http.MethodOptions, "/api/chat", nil)
		request.Header.Set("Origin", "https://evil.example")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("allow-origin = %q, want empty", got)
		}
	})
}

func TestCORSHeaderOnResponse(t *testing.T) {
	body, contentType := buildForm(t, map[string]string{FieldText: "q"}, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/chat", body)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Authorization", BearerPrefix+testPassword)
	request.Header.Set("Origin", testOrigin)
	recorder := httptest.NewRecorder()
	newTestHandler(&fakeResponder{reply: "ok"}).ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
		t.Errorf("allow-origin = %q", got)
	}
}

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	newTestHandler(&fakeResponder{}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusNoContent {
		t.Errorf("status = %d", recorder.Code)
	}
}
