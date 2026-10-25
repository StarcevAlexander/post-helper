package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/places"
	"post-helper/server/internal/push"
)

type pushHandler struct {
	store    push.Store
	sender   push.Sender
	accounts accounts.Store
	logger   *slog.Logger
}

func (h *pushHandler) key(w http.ResponseWriter, _ *http.Request) {
	if h.sender == nil {
		writeError(w, http.StatusServiceUnavailable, MsgPushOff)
		return
	}
	writeJSON(w, http.StatusOK, PushKeyResponse{PublicKey: h.sender.PublicKey()})
}

func (h *pushHandler) subscribe(w http.ResponseWriter, r *http.Request) {
	if h.sender == nil {
		writeError(w, http.StatusServiceUnavailable, MsgPushOff)
		return
	}
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxPushBodyBytes)
	var body PushSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgPushBadRequest)
		return
	}
	subscription, err := push.CleanSubscription(body.Endpoint, body.Keys.P256dh, body.Keys.Auth)
	if err != nil {
		writeError(w, http.StatusBadRequest, MsgPushBadRequest)
		return
	}
	if err := h.store.Save(r.Context(), identity.MasterID, subscription, time.Now()); err != nil {
		h.logger.Error("save push subscription failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgPushFailed)
		return
	}
	h.adoptZone(r.Context(), identity.MasterID, body.TimeZone)
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandler) adoptZone(ctx context.Context, masterID, zone string) {
	zone = strings.TrimSpace(zone)
	if !places.ValidZone(zone) {
		return
	}
	master, err := h.accounts.GetMaster(ctx, masterID)
	if err != nil {
		h.logger.Error("load master for time zone failed", slog.Any("error", err))
		return
	}
	if master.Timezone != "" {
		return
	}
	if err := h.accounts.SetLocation(ctx, masterID, master.City, zone); err != nil {
		h.logger.Error("save time zone from the push subscription failed", slog.Any("error", err))
	}
}

func (h *pushHandler) unsubscribe(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxPushBodyBytes)
	var body PushUnsubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, MsgPushBadRequest)
		return
	}
	if err := h.store.Remove(r.Context(), identity.MasterID, body.Endpoint); err != nil {
		h.logger.Error("remove push subscription failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgPushFailed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandler) adminSend(w http.ResponseWriter, r *http.Request) {
	if h.sender == nil {
		writeError(w, http.StatusServiceUnavailable, MsgPushOff)
		return
	}
	id := r.PathValue("id")
	r.Body = http.MaxBytesReader(w, r.Body, MaxPushBodyBytes)
	var body AdminPushRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgPushBadMessage)
		return
	}
	message, err := push.CleanMessage(body.Title, body.Body, body.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, MsgPushBadMessage)
		return
	}
	sent, err := h.sender.Send(r.Context(), id, message)
	if err != nil {
		h.logger.Error("send push failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgPushFailed)
		return
	}
	h.record(r.Context(), id, sent, message.Title)
	writeJSON(w, http.StatusOK, AdminPushResponse{Sent: sent})
}

func (h *pushHandler) record(ctx context.Context, masterID string, sent int, title string) {
	payload, _ := json.Marshal(map[string]any{"sent": sent, "title": title})
	if err := h.accounts.RecordEvent(ctx, masterID, EventPushSent, payload, time.Now()); err != nil && !errors.Is(err, accounts.ErrNotFound) {
		h.logger.Error("record push event failed", slog.Any("error", err))
	}
}

func (h *pushHandler) notify(ctx context.Context, masterID string, message push.Message) {
	if h.sender == nil {
		return
	}
	detached := context.WithoutCancel(ctx)
	safeGo(h.logger, "push notify", func() {
		sendCtx, cancel := context.WithTimeout(detached, push.SendTimeout*2)
		defer cancel()
		sent, err := h.sender.Send(sendCtx, masterID, message)
		if err != nil {
			h.logger.Error("push notify failed", slog.Any("error", err))
			return
		}
		h.record(sendCtx, masterID, sent, message.Title)
	})
}
