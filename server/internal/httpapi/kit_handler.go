package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"post-helper/server/internal/chat"
	"post-helper/server/internal/kit"
	"post-helper/server/internal/store"
)

type kitHandler struct {
	journal   *journal
	generator kit.Generator
	recorder  store.Recorder
	logger    *slog.Logger
}

func (h *kitHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxKitBodyBytes)
	var body KitRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}

	request, message := cleanKitRequest(body)
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), chat.RequestTimeout)
	defer cancel()

	result, err := h.generator.Generate(ctx, request)
	switch {
	case errors.Is(err, kit.ErrRefused):
		writeError(w, http.StatusUnprocessableEntity, MsgKitRefused)
	case err != nil:
		h.logger.Error("kit failed", slog.Any("error", err))
		writeError(w, http.StatusBadGateway, MsgKitFailed)
	default:
		h.logger.Info("kit generated", slog.String("format", request.Format), slog.Int("frames", len(result.Frames)))
		h.recorder.SaveEvent(store.EventKit, "", map[string]any{"format": request.Format, "pillar": request.Pillar, "idea": request.Idea})
		h.journal.record(r, UsageKit, map[string]any{
			"request": map[string]string{"format": request.Format, "pillar": request.Pillar, "idea": request.Idea},
			"kit":     result,
		})
		writeJSON(w, http.StatusOK, result)
	}
}

func cleanKitRequest(body KitRequest) (kit.Request, string) {
	profile, _, message := cleanProfile(body.Profile)
	if message != "" {
		return kit.Request{}, message
	}
	format := strings.TrimSpace(body.Format)
	if !kit.ValidFormat(format) {
		return kit.Request{}, MsgBadFormat
	}
	idea := strings.TrimSpace(body.Idea)
	if idea == "" {
		return kit.Request{}, MsgNoIdea
	}
	pillar := strings.TrimSpace(body.Pillar)
	positioning := strings.TrimSpace(body.Positioning)
	for _, field := range []string{idea, pillar, positioning} {
		if utf8.RuneCountInString(field) > MaxKitFieldRunes {
			return kit.Request{}, MsgKitFieldTooLong
		}
	}
	return kit.Request{Profile: profile, Positioning: positioning, Format: format, Pillar: pillar, Idea: idea}, ""
}
