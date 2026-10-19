package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"post-helper/server/internal/store"
)

type historyHandler struct {
	reader store.Reader
	logger *slog.Logger
}

func (h *historyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	messages, err := h.reader.Messages(r.Context(), store.MessageFilter{
		Source:         query.Get(QuerySource),
		ConversationID: query.Get(QueryConversation),
		Limit:          limitParam(query.Get(QueryLimit)),
	})
	if err != nil {
		h.logger.Error("read history failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgHistoryFailed)
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

type eventsHandler struct {
	reader store.Reader
	logger *slog.Logger
}

func (h *eventsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	events, err := h.reader.Events(r.Context(), query.Get(QueryKind), limitParam(query.Get(QueryLimit)))
	if err != nil {
		h.logger.Error("read events failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgHistoryFailed)
		return
	}
	writeJSON(w, http.StatusOK, events)
}

type errorsHandler struct {
	reader store.Reader
	logger *slog.Logger
}

func (h *errorsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	entries, err := h.reader.Errors(r.Context(), limitParam(r.URL.Query().Get(QueryLimit)))
	if err != nil {
		h.logger.Error("read error log failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgHistoryFailed)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

type ingestHandler struct {
	recorder store.Recorder
}

func (h *ingestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxIngestBodyBytes)
	var body IngestRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadIngest)
		return
	}
	source := strings.TrimSpace(body.Source)
	if source == "" || len(body.Messages) == 0 || len(body.Messages) > MaxIngestMessages {
		writeError(w, http.StatusBadRequest, MsgBadIngest)
		return
	}

	messages := make([]store.Message, 0, len(body.Messages))
	for _, m := range body.Messages {
		text := strings.TrimSpace(m.Text)
		if text == "" || m.Role == "" {
			continue
		}
		messages = append(messages, store.Message{
			Source:         source,
			ConversationID: body.ConversationID,
			ExternalID:     m.ExternalID,
			Role:           m.Role,
			Text:           text,
			CreatedAt:      m.At,
		})
	}
	h.recorder.SaveMessages(messages)
	h.recorder.SaveEvent(store.EventIngest, body.ConversationID, map[string]any{"source": source, "messages": len(messages)})
	writeJSON(w, http.StatusAccepted, IngestResponse{Accepted: len(messages)})
}

type clientErrorHandler struct {
	recorder store.Recorder
}

func (h *clientErrorHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxClientErrorBytes)
	var body ClientErrorRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	message := clipRunes(strings.TrimSpace(body.Message), maxClientErrorFields)
	if message == "" {
		writeError(w, http.StatusBadRequest, MsgEmptyMessage)
		return
	}
	h.recorder.SaveError(store.ErrorSourceClient, message, map[string]string{
		"where":   clipRunes(body.Where, maxClientErrorFields),
		"stack":   clipRunes(body.Stack, maxClientErrorFields*4),
		"version": clipRunes(body.Version, 64),
	})
	w.WriteHeader(http.StatusNoContent)
}

func limitParam(raw string) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return value
}

func clipRunes(text string, maxRunes int) string {
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	return string([]rune(text)[:maxRunes])
}
