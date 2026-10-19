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
	"post-helper/server/internal/store"
	"post-helper/server/internal/strategy"
)

type strategyHandler struct {
	generator strategy.Generator
	recorder  store.Recorder
	logger    *slog.Logger
}

func (h *strategyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxStrategyBodyBytes)
	var profile strategy.Profile
	if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}

	profile, status, message := cleanProfile(profile)
	if message != "" {
		writeError(w, status, message)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), chat.RequestTimeout)
	defer cancel()

	result, err := h.generator.Generate(ctx, profile)
	var insufficient *strategy.InsufficientError
	switch {
	case errors.As(err, &insufficient):
		writeError(w, http.StatusUnprocessableEntity, MsgStrategyInsufficient+insufficient.Reason)
	case errors.Is(err, strategy.ErrRefused):
		writeError(w, http.StatusUnprocessableEntity, MsgStrategyRefused)
	case err != nil:
		h.logger.Error("strategy failed", slog.Any("error", err))
		writeError(w, http.StatusBadGateway, MsgStrategyFailed)
	default:
		h.logger.Info("strategy generated", slog.Int("pillars", len(result.Pillars)))
		h.recorder.SaveEvent(store.EventStrategy, "", map[string]any{"profile": profile, "strategy": result})
		writeJSON(w, http.StatusOK, result)
	}
}

func cleanProfile(profile strategy.Profile) (strategy.Profile, int, string) {
	fields := []*string{
		&profile.Name, &profile.Specialty, &profile.City, &profile.Experience, &profile.Services,
		&profile.Clients, &profile.Goal, &profile.Instagram, &profile.Style, &profile.Audit,
	}
	for _, field := range fields {
		*field = strings.TrimSpace(*field)
		if utf8.RuneCountInString(*field) > MaxProfileFieldRunes {
			return strategy.Profile{}, http.StatusBadRequest, MsgProfileTooLong
		}
	}
	if profile.Specialty == "" {
		return strategy.Profile{}, http.StatusBadRequest, MsgNoSpecialty
	}
	return profile, 0, ""
}
