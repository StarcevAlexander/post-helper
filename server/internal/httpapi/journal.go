package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
)

const (
	maxEventPayloadBytes = 256 << 10
	journalTimeout       = 5 * time.Second
)

type journal struct {
	accounts accounts.Store
	logger   *slog.Logger
}

func (j *journal) record(r *http.Request, kind string, payload any) {
	if j == nil {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok || identity.MasterID == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		j.logger.Error("encode event failed", slog.String("kind", kind), slog.Any("error", err))
		return
	}
	if len(data) > maxEventPayloadBytes {
		data, _ = json.Marshal(map[string]any{"truncated": true, "bytes": len(data)})
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), journalTimeout)
	defer cancel()
	if err := j.accounts.RecordEvent(ctx, identity.MasterID, kind, data, time.Now()); err != nil {
		j.logger.Error("record event failed", slog.String("kind", kind), slog.Any("error", err))
	}
}
