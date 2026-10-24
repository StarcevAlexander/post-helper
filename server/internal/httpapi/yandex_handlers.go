package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/yandex"
)

type signInLimiter struct {
	mu     sync.Mutex
	hits   []time.Time
	max    int
	window time.Duration
}

func (l *signInLimiter) allow(now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-l.window)
	l.hits = slices.DeleteFunc(l.hits, func(at time.Time) bool { return at.Before(cutoff) })
	if len(l.hits) >= l.max {
		return false
	}
	l.hits = append(l.hits, now)
	return true
}

type authHandler struct {
	accounts       accounts.Store
	exchanger      yandex.Exchanger
	clientID       string
	allowedOrigins []string
	limiter        *signInLimiter
	logger         *slog.Logger
}

func (h *authHandler) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, AuthConfigResponse{YandexClientID: h.clientID})
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	profile, ok := h.verify(w, r)
	if !ok {
		return
	}
	master, err := h.accounts.FindByIdentity(r.Context(), accounts.ProviderYandex, profile.ID)
	if errors.Is(err, accounts.ErrNotFound) {
		master, err = h.register(r, profile)
	}
	if err != nil {
		h.logger.Error("yandex sign-in failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgSignInFailed)
		return
	}
	if master.Disabled {
		writeError(w, http.StatusForbidden, MsgAccessDisabled)
		return
	}

	token, err := auth.GenerateCode()
	if err == nil {
		err = h.accounts.AddToken(r.Context(), master.ID, auth.HashCode(token))
	}
	if err != nil {
		h.logger.Error("issue token failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgSignInFailed)
		return
	}
	writeJSON(w, http.StatusOK, SessionResponse{Token: token, Name: master.Name})
}

func (h *authHandler) register(r *http.Request, profile yandex.Profile) (accounts.Master, error) {
	unusable, err := auth.GenerateCode()
	if err != nil {
		return accounts.Master{}, err
	}
	master, err := h.accounts.RegisterIdentity(r.Context(), masterNameOf(profile),
		auth.HashCode(unusable), accounts.ProviderYandex, profile.ID, profile.Email)
	if errors.Is(err, accounts.ErrIdentityTaken) {
		return h.accounts.FindByIdentity(r.Context(), accounts.ProviderYandex, profile.ID)
	}
	return master, err
}

func (h *authHandler) link(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	profile, ok := h.verify(w, r)
	if !ok {
		return
	}
	err := h.accounts.LinkIdentity(r.Context(), identity.MasterID, accounts.ProviderYandex, profile.ID, profile.Email)
	switch {
	case errors.Is(err, accounts.ErrIdentityTaken):
		writeError(w, http.StatusConflict, MsgYandexTaken)
		return
	case err != nil:
		h.logger.Error("link yandex failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgSignInFailed)
		return
	}
	providers, err := h.accounts.Providers(r.Context(), identity.MasterID)
	if err != nil {
		h.logger.Error("list providers failed", slog.Any("error", err))
		providers = []string{accounts.ProviderYandex}
	}
	writeJSON(w, http.StatusOK, ProvidersResponse{Providers: providers})
}

func (h *authHandler) verify(w http.ResponseWriter, r *http.Request) (yandex.Profile, bool) {
	if h.exchanger == nil {
		http.NotFound(w, r)
		return yandex.Profile{}, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxYandexCodeBytes)
	var body YandexCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return yandex.Profile{}, false
	}
	code := strings.TrimSpace(body.Code)
	if code == "" || !h.redirectAllowed(body.RedirectURI) {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return yandex.Profile{}, false
	}
	if !h.limiter.allow(time.Now()) {
		writeError(w, http.StatusTooManyRequests, MsgTooManySignIns)
		return yandex.Profile{}, false
	}
	profile, err := h.exchanger.Exchange(r.Context(), code, body.RedirectURI)
	switch {
	case errors.Is(err, yandex.ErrRejected):
		writeError(w, http.StatusForbidden, MsgYandexRejected)
		return yandex.Profile{}, false
	case err != nil:
		h.logger.Error("yandex exchange failed", slog.Any("error", err))
		writeError(w, http.StatusBadGateway, MsgYandexUnavailable)
		return yandex.Profile{}, false
	}
	return profile, true
}

func (h *authHandler) redirectAllowed(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return false
	}
	return slices.Contains(h.allowedOrigins, parsed.Scheme+"://"+parsed.Host)
}

func masterNameOf(profile yandex.Profile) string {
	for _, candidate := range []string{profile.RealName, profile.DisplayName, profile.Login} {
		if name := strings.TrimSpace(candidate); name != "" {
			if utf8.RuneCountInString(name) > MaxMasterNameRunes {
				name = string([]rune(name)[:MaxMasterNameRunes])
			}
			return name
		}
	}
	return DefaultMasterName
}
