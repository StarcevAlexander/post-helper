package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/intake"
)

type feedbackHandler struct {
	feedback feedback.Store
	accounts accounts.Store
	notifier intake.Notifier
	logger   *slog.Logger
}

func (h *feedbackHandler) submit(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxFeedbackBodyBytes)
	var body FeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	text, contact, err := feedback.Clean(body.Text, body.Contact)
	switch {
	case errors.Is(err, feedback.ErrEmptyText):
		writeError(w, http.StatusBadRequest, MsgFeedbackEmpty)
		return
	case errors.Is(err, feedback.ErrLongText):
		writeError(w, http.StatusBadRequest, MsgFeedbackLongText)
		return
	case errors.Is(err, feedback.ErrLongContact):
		writeError(w, http.StatusBadRequest, MsgFeedbackLongContact)
		return
	}

	now := time.Now()
	recent, err := h.feedback.CountSince(r.Context(), identity.MasterID, now.Add(-time.Hour))
	if err != nil {
		h.logger.Error("count feedback failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgFeedbackFailed)
		return
	}
	if recent >= feedback.MaxPerHour {
		writeError(w, http.StatusTooManyRequests, MsgFeedbackTooMany)
		return
	}

	id, err := feedback.NewID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, MsgFeedbackFailed)
		return
	}
	email, err := h.accounts.Email(r.Context(), identity.MasterID)
	if err != nil {
		h.logger.Error("load master email failed", slog.Any("error", err))
	}
	message, err := h.feedback.Add(r.Context(), feedback.Message{
		ID:         id,
		MasterID:   identity.MasterID,
		MasterName: identity.Name,
		Email:      email,
		Contact:    contact,
		Text:       text,
		CreatedAt:  now,
	})
	if err != nil {
		h.logger.Error("save feedback failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgFeedbackFailed)
		return
	}
	h.announce(r.Context(), message)
	w.WriteHeader(http.StatusNoContent)
}

func (h *feedbackHandler) announce(ctx context.Context, message feedback.Message) {
	if h.notifier == nil {
		h.logger.Warn("feedback notifier is not configured: the owner will not be notified")
		return
	}
	text := feedback.Announcement(message)
	go func() {
		notifyCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), intake.TelegramTimeout)
		defer cancel()
		if err := h.notifier.Notify(notifyCtx, text); err != nil {
			h.logger.Error("notify owner about feedback failed", slog.Any("error", err))
		}
	}()
}

func (h *feedbackHandler) list(w http.ResponseWriter, r *http.Request) {
	listed, err := h.feedback.List(r.Context(), MaxFeedbackList)
	if err != nil {
		h.logger.Error("list feedback failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgFeedbackFailed)
		return
	}
	writeJSON(w, http.StatusOK, listed)
}
