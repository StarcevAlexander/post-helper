package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/chat"
	"post-helper/server/internal/store"
	"post-helper/server/internal/strategy"
)

type Options struct {
	Responder      chat.Responder
	Strategist     strategy.Generator
	Password       string
	AllowedOrigins []string
	Store          store.Store
	Logger         *slog.Logger
}

type IngestRequest struct {
	Source         string          `json:"source"`
	ConversationID string          `json:"conversationId"`
	Messages       []IngestMessage `json:"messages"`
}

type IngestMessage struct {
	ExternalID string    `json:"externalId"`
	Role       string    `json:"role"`
	Text       string    `json:"text"`
	At         time.Time `json:"at"`
}

type IngestResponse struct {
	Accepted int `json:"accepted"`
}

type ClientErrorRequest struct {
	Message string `json:"message"`
	Where   string `json:"where"`
	Stack   string `json:"stack"`
	Version string `json:"version"`
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

type ReplyResponse struct {
	Reply string `json:"reply"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}
