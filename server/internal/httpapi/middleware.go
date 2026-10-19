package httpapi

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
)

func withCORS(allowedOrigins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && slices.Contains(allowedOrigins, origin) {
			header := w.Header()
			header.Set("Access-Control-Allow-Origin", origin)
			header.Add("Vary", "Origin")
			if r.Method == http.MethodOptions {
				header.Set("Access-Control-Allow-Methods", CORSMethods)
				header.Set("Access-Control-Allow-Headers", CORSHeaders)
				header.Set("Access-Control-Max-Age", CORSMaxAge)
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func withLogging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == HealthPath || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logger.Info("request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", recorder.status),
			slog.Int64("bytes", r.ContentLength),
			slog.Duration("took", time.Since(started).Round(time.Millisecond)),
		)
	})
}

func withRecover(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic in handler",
					slog.String("path", r.URL.Path),
					slog.Any("panic", recovered),
					slog.String("stack", string(debug.Stack())),
				)
				writeError(w, http.StatusInternalServerError, MsgUpstreamFailed)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func withAuth(authenticator *auth.Authenticator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := authenticator.Authenticate(r.Context(), bearerToken(r))
		if !ok {
			select {
			case <-time.After(AuthFailDelay):
			case <-r.Context().Done():
			}
			writeError(w, http.StatusUnauthorized, MsgUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithIdentity(r.Context(), identity)))
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if identity, ok := auth.FromContext(r.Context()); !ok || !identity.Admin {
			writeError(w, http.StatusForbidden, MsgForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireMaster(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if identity, ok := auth.FromContext(r.Context()); !ok || identity.MasterID == "" {
			writeError(w, http.StatusForbidden, MsgMasterOnly)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withQuota(store accounts.Store, limit int, kind string, logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := auth.FromContext(r.Context())
		if !ok || identity.Admin || limit <= 0 {
			next.ServeHTTP(w, r)
			return
		}
		now := time.Now()
		used, err := store.CountUsage(r.Context(), identity.MasterID, dayStart(now))
		if err != nil {
			logger.Error("count usage failed", slog.Any("error", err))
		} else if used >= limit {
			writeError(w, http.StatusTooManyRequests, MsgQuotaExceeded)
			return
		}
		if err := store.RecordUsage(r.Context(), identity.MasterID, kind, now); err != nil {
			logger.Error("record usage failed", slog.Any("error", err))
		}
		next.ServeHTTP(w, r)
	})
}

func dayStart(now time.Time) time.Time {
	utc := now.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}
func bearerToken(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, BearerPrefix) {
		return ""
	}
	return strings.TrimPrefix(value, BearerPrefix)
}
