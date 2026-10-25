package httpapi

import (
	"log/slog"
	"net/http"
)

func digestHandler(digest DigestSender, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if digest == nil {
			writeError(w, http.StatusServiceUnavailable, MsgDigestOff)
			return
		}
		text, err := digest.Send(r.Context())
		if err != nil {
			logger.Error("send digest on demand failed", slog.Any("error", err))
			writeError(w, http.StatusBadGateway, MsgDigestFailed)
			return
		}
		writeJSON(w, http.StatusOK, DigestResponse{Text: text})
	}
}
