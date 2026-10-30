package zai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(apiKey, baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		apiKey:  strings.TrimSpace(apiKey),
		http:    &http.Client{},
	}
}

type imageURL struct {
	URL string `json:"url"`
}

type imagePart struct {
	Type     string   `json:"type"`
	ImageURL imageURL `json:"image_url"`
}

type textPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatRequest struct {
	Model           string        `json:"model"`
	Messages        []chatMessage `json:"messages"`
	MaxTokens       int           `json:"max_tokens,omitempty"`
	ReasoningEffort string        `json:"reasoning_effort,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (r Request) messages() []chatMessage {
	messages := make([]chatMessage, 0, 2)
	if r.System != "" {
		messages = append(messages, chatMessage{Role: "system", Content: r.System})
	}
	if len(r.Images) == 0 {
		messages = append(messages, chatMessage{Role: "user", Content: r.Text})
		return messages
	}
	parts := make([]any, 0, len(r.Images)+1)
	for _, image := range r.Images {
		url := fmt.Sprintf("data:%s;base64,%s", image.MediaType, base64.StdEncoding.EncodeToString(image.Data))
		parts = append(parts, imagePart{Type: "image_url", ImageURL: imageURL{URL: url}})
	}
	parts = append(parts, textPart{Type: "text", Text: r.Text})
	messages = append(messages, chatMessage{Role: "user", Content: parts})
	return messages
}

func (c *Client) Complete(ctx context.Context, request Request) (string, error) {
	payload, err := json.Marshal(chatRequest{
		Model:           request.Model,
		Messages:        request.messages(),
		MaxTokens:       request.MaxTokens,
		ReasoningEffort: request.ReasoningEffort,
	})
	if err != nil {
		return "", fmt.Errorf("zai encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("zai build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("zai request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("zai read response: %w", err)
	}
	if response.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("zai http %d: %s", response.StatusCode, truncate(string(body), DetailLimit))
	}
	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("zai decode response: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("zai error: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return "", ErrNoAnswer
	}
	choice := parsed.Choices[0]
	if choice.FinishReason == FinishReasonSensitive {
		return "", ErrRefused
	}
	return choice.Message.Content, nil
}

func truncate(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit]
}
