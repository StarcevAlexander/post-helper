package zai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func captureBody(t *testing.T, status int, responseBody string) (*httptest.Server, map[string]any) {
	t.Helper()
	captured := map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer key" {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Errorf("decode body %q: %v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if _, err := w.Write([]byte(responseBody)); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	return server, captured
}

func messageOf(t *testing.T, captured map[string]any, index int) map[string]any {
	t.Helper()
	messages, ok := captured["messages"].([]any)
	if !ok || len(messages) <= index {
		t.Fatalf("messages = %#v", captured["messages"])
	}
	message, ok := messages[index].(map[string]any)
	if !ok {
		t.Fatalf("message %d = %#v", index, messages[index])
	}
	return message
}

func TestCompleteTextOnly(t *testing.T) {
	server, captured := captureBody(t, http.StatusOK, `{"choices":[{"message":{"content":"ответ"},"finish_reason":"stop"}]}`)
	defer server.Close()

	text, err := New("key", server.URL).Complete(context.Background(), Request{
		Model: "glm-5.3", System: "правила", Text: "вопрос", MaxTokens: 100, ReasoningEffort: "low",
	})
	if err != nil {
		t.Fatal(err)
	}
	if text != "ответ" {
		t.Errorf("text = %q", text)
	}
	if captured["model"] != "glm-5.3" || captured["max_tokens"] != float64(100) || captured["reasoning_effort"] != "low" {
		t.Errorf("captured = %#v", captured)
	}
	if messageOf(t, captured, 0)["role"] != "system" || messageOf(t, captured, 0)["content"] != "правила" {
		t.Errorf("system message = %#v", captured["messages"])
	}
	if messageOf(t, captured, 1)["content"] != "вопрос" {
		t.Errorf("user message = %#v", captured["messages"])
	}
}

func TestCompleteSendsImages(t *testing.T) {
	server, captured := captureBody(t, http.StatusOK, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
	defer server.Close()

	_, err := New("key", server.URL+"/").Complete(context.Background(), Request{
		Model:  "glm-5.3-flash",
		System: "правила",
		Text:   "опиши",
		Images: []Image{{MediaType: "image/jpeg", Data: []byte{1, 2, 3}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, hasEffort := captured["reasoning_effort"]
	if hasEffort {
		t.Errorf("reasoning_effort must be omitted when empty: %#v", captured)
	}
	user := messageOf(t, captured, 1)
	parts, ok := user["content"].([]any)
	if !ok || len(parts) != 2 {
		t.Fatalf("content = %#v", user["content"])
	}
	image, _ := parts[0].(map[string]any)
	url, _ := image["image_url"].(map[string]any)
	if image["type"] != "image_url" || !strings.HasPrefix(url["url"].(string), "data:image/jpeg;base64,") {
		t.Errorf("image part = %#v", parts[0])
	}
	if text, _ := parts[1].(map[string]any); text["type"] != "text" || text["text"] != "опиши" {
		t.Errorf("text part = %#v", parts[1])
	}
}

func TestCompleteMapsRefusal(t *testing.T) {
	server, _ := captureBody(t, http.StatusOK, `{"choices":[{"message":{"content":""},"finish_reason":"sensitive"}]}`)
	defer server.Close()

	if _, err := New("key", server.URL).Complete(context.Background(), Request{Model: "glm-5.3"}); !errors.Is(err, ErrRefused) {
		t.Fatalf("err = %v, want ErrRefused", err)
	}
}

func TestCompleteHttpError(t *testing.T) {
	server, _ := captureBody(t, http.StatusUnauthorized, `{"error":{"message":"bad key"}}`)
	defer server.Close()

	_, err := New("key", server.URL).Complete(context.Background(), Request{Model: "glm-5.3"})
	if err == nil || !strings.Contains(err.Error(), "zai http 401") || !strings.Contains(err.Error(), "bad key") {
		t.Fatalf("err = %v", err)
	}
}

func TestCompleteNoChoices(t *testing.T) {
	server, _ := captureBody(t, http.StatusOK, `{}`)
	defer server.Close()

	if _, err := New("key", server.URL).Complete(context.Background(), Request{Model: "glm-5.3"}); !errors.Is(err, ErrNoAnswer) {
		t.Fatalf("err = %v, want ErrNoAnswer", err)
	}
}
