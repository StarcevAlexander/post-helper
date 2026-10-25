package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"post-helper/server/internal/auth"
	"runtime/debug"
	"slices"
	"strings"
	"time"
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

func withLocalOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != HealthPath && !localRequest(r) {
			writeError(w, http.StatusForbidden, MsgAdminForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func localRequest(r *http.Request) bool {
	if _, present := r.Header[HeaderOrigin]; present {
		return false
	}
	if site := r.Header.Get(HeaderFetchSite); site != "" && site != FetchSiteNone {
		return false
	}
	return loopbackHost(r.Host)
}

func loopbackHost(hostport string) bool {
	host := hostport
	if parsed, _, err := net.SplitHostPort(hostport); err == nil {
		host = parsed
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	switch strings.ToLower(host) {
	case LoopbackHostV4, LoopbackHostName, LoopbackHostV6:
		return true
	}
	return false
}

func healthHandler(ping func(context.Context) error, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ping != nil {
			ctx, cancel := context.WithTimeout(r.Context(), HealthPingTimeout)
			defer cancel()
			if err := ping(ctx); err != nil {
				logger.Warn("health check: database ping failed", slog.Any("error", err))
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func safeGo(logger *slog.Logger, name string, fn func()) {
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic in background task",
					slog.String("task", name),
					slog.Any("panic", recovered),
					slog.String("stack", string(debug.Stack())),
				)
			}
		}()
		fn()
	}()
}

func withAuth(logger *slog.Logger, authenticator *auth.Authenticator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, err := authenticator.Authenticate(r.Context(), bearerToken(r))
		if errors.Is(err, auth.ErrStore) {
			logger.Error("authentication store failed", slog.Any("error", err))
			writeError(w, http.StatusServiceUnavailable, MsgAuthUnavailable)
			return
		}
		if err != nil {
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
