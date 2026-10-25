package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"post-helper/server/internal/auth"
	"post-helper/server/internal/store"
)

type clientErrorHandler struct {
	recorder store.Recorder
	limiter  *rateLimiter
}

func (h *clientErrorHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	if !h.limiter.allow(identity.MasterID, time.Now()) {
		writeError(w, http.StatusTooManyRequests, MsgTooManyClientErrors)
		return
	}
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
