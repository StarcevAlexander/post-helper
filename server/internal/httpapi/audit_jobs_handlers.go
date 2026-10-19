package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/chat"
	"post-helper/server/internal/strategy"
)

type auditJobsHandler struct {
	accounts accounts.Store
	logger   *slog.Logger
}

func (h *auditJobsHandler) create(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body AuditJobRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	if !body.Consent {
		writeError(w, http.StatusBadRequest, MsgConsentRequired)
		return
	}
	handle, ok := audit.NormalizeHandle(body.Handle)
	if !ok {
		writeError(w, http.StatusBadRequest, MsgBadHandle)
		return
	}

	job, err := h.accounts.CreateAuditJob(r.Context(), identity.MasterID, handle, time.Now())
	switch {
	case errors.Is(err, accounts.ErrJobActive):
		writeJSON(w, http.StatusConflict, AuditJobConflict{Error: MsgJobActive, Job: job})
	case err != nil:
		h.logger.Error("create audit job failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
	default:
		h.recordEvent(r.Context(), job.MasterID, EventJobCreated, map[string]string{"handle": handle, "jobId": job.ID})
		writeJSON(w, http.StatusOK, job)
	}
}

func (h *auditJobsHandler) latest(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	job, err := h.accounts.LatestAuditJob(r.Context(), identity.MasterID)
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		w.WriteHeader(http.StatusNoContent)
	case err != nil:
		h.logger.Error("load audit job failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
	default:
		writeJSON(w, http.StatusOK, job)
	}
}

func (h *auditJobsHandler) cancel(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	err := h.accounts.CancelAuditJob(r.Context(), identity.MasterID, r.PathValue("id"), time.Now())
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgJobNotFound)
	case errors.Is(err, accounts.ErrJobState):
		writeError(w, http.StatusConflict, MsgJobState)
	case err != nil:
		h.logger.Error("cancel audit job failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"canceled": true})
	}
}

func (h *auditJobsHandler) list(w http.ResponseWriter, r *http.Request) {
	jobs, err := h.accounts.ListAuditJobs(r.Context(), limitParam(r.URL.Query().Get(QueryLimit)))
	if err != nil {
		h.logger.Error("list audit jobs failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (h *auditJobsHandler) recordEvent(ctx context.Context, masterID, kind string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), journalTimeout)
	defer cancel()
	if err := h.accounts.RecordEvent(ctx, masterID, kind, data, time.Now()); err != nil {
		h.logger.Error("record event failed", slog.String("kind", kind), slog.Any("error", err))
	}
}

func (h *auditJobsHandler) profileOf(ctx context.Context, masterID string) strategy.Profile {
	state, err := h.accounts.LoadState(ctx, masterID)
	if err != nil {
		return strategy.Profile{}
	}
	var stored struct {
		Onboarding struct {
			Answers strategy.Profile `json:"answers"`
		} `json:"onboarding"`
	}
	if err := json.Unmarshal(state.Data, &stored); err != nil {
		return strategy.Profile{}
	}
	profile := stored.Onboarding.Answers
	profile.Audit = ""
	return profile
}

type agentHandler struct {
	auditJobsHandler
	generator audit.Generator
}

func (h *agentHandler) next(w http.ResponseWriter, r *http.Request) {
	job, err := h.accounts.ClaimAuditJob(r.Context(), time.Now(), JobLease)
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		w.WriteHeader(http.StatusNoContent)
	case err != nil:
		h.logger.Error("claim audit job failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
	default:
		profile := h.profileOf(r.Context(), job.MasterID)
		writeJSON(w, http.StatusOK, AgentJob{
			ID:       job.ID,
			Handle:   job.Handle,
			Attempts: job.Attempts,
			Profile:  JobProfile{Name: profile.Name, Specialty: profile.Specialty, City: profile.City},
		})
	}
}

func (h *agentHandler) fail(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body AgentFailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	reason := strings.TrimSpace(body.Reason)
	if utf8.RuneCountInString(reason) > MaxJobReasonRunes {
		reason = string([]rune(reason)[:MaxJobReasonRunes-1]) + "…"
	}
	if reason == "" {
		reason = "агент не смог открыть профиль"
	}
	id := r.PathValue("id")
	if status, message := h.finish(r.Context(), id, func() error {
		return h.accounts.FailAuditJob(r.Context(), id, reason, body.Final, time.Now())
	}); message != "" {
		writeError(w, status, message)
		return
	}
	if job, err := h.accounts.AuditJob(r.Context(), id); err == nil {
		h.recordEvent(r.Context(), job.MasterID, EventJobFailed, map[string]any{"handle": job.Handle, "reason": reason, "final": job.Status == accounts.JobFailed})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *agentHandler) finish(_ context.Context, _ string, action func() error) (int, string) {
	err := action()
	switch {
	case err == nil:
		return 0, ""
	case errors.Is(err, accounts.ErrNotFound):
		return http.StatusNotFound, MsgJobNotFound
	case errors.Is(err, accounts.ErrJobState):
		return http.StatusConflict, MsgJobState
	default:
		h.logger.Error("audit job action failed", slog.Any("error", err))
		return http.StatusInternalServerError, MsgJobFailed
	}
}

func (h *agentHandler) result(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, err := h.accounts.AuditJob(r.Context(), id)
	if errors.Is(err, accounts.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgJobNotFound)
		return
	}
	if err != nil {
		h.logger.Error("load audit job failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
		return
	}
	if job.Status != accounts.JobRunning {
		writeError(w, http.StatusConflict, MsgJobState)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxAuditBodyBytes)
	if err := r.ParseMultipartForm(MaxFormMemory); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
			return
		}
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	var collected audit.Collected
	if err := json.Unmarshal([]byte(r.FormValue(FieldData)), &collected); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadCollected)
		return
	}
	images, status, message := readAuditImages(r.MultipartForm.File[FieldImages], audit.MaxAgentImages, h.logger)
	if message != "" {
		writeError(w, status, message)
		return
	}
	if handle, ok := audit.NormalizeHandle(collected.Handle); !ok || handle != job.Handle {
		collected.Handle = job.Handle
	}

	ctx, cancel := context.WithTimeout(r.Context(), chat.RequestTimeout)
	defer cancel()
	result, err := h.generator.Generate(ctx, audit.Request{
		Profile: h.profileOf(r.Context(), job.MasterID),
		Images:  images,
		Extra:   audit.DescribeCollected(collected),
	})
	var unreadable *audit.UnreadableError
	switch {
	case errors.As(err, &unreadable):
		_ = h.accounts.FailAuditJob(r.Context(), id, MsgAuditUnreadable+unreadable.Reason, false, time.Now())
		writeError(w, http.StatusUnprocessableEntity, MsgAuditUnreadable+unreadable.Reason)
		return
	case errors.Is(err, audit.ErrRefused):
		_ = h.accounts.FailAuditJob(r.Context(), id, MsgAuditRefused, true, time.Now())
		writeError(w, http.StatusUnprocessableEntity, MsgAuditRefused)
		return
	case err != nil:
		h.logger.Error("audit by agent failed", slog.Any("error", err))
		_ = h.accounts.FailAuditJob(r.Context(), id, MsgAuditFailed, false, time.Now())
		writeError(w, http.StatusBadGateway, MsgAuditFailed)
		return
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		writeError(w, http.StatusInternalServerError, MsgJobFailed)
		return
	}
	if status, message := h.finish(r.Context(), id, func() error {
		return h.accounts.CompleteAuditJob(r.Context(), id, encoded, time.Now())
	}); message != "" {
		writeError(w, status, message)
		return
	}
	if err := h.accounts.RecordUsage(r.Context(), job.MasterID, UsageAuditJob, time.Now()); err != nil {
		h.logger.Error("record usage failed", slog.Any("error", err))
	}
	h.recordEvent(r.Context(), job.MasterID, "audit", map[string]any{
		"handle": job.Handle,
		"images": imageNames(images),
		"source": "agent",
		"result": result,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func withAgentToken(token string, next http.Handler) http.Handler {
	expected := sha256.Sum256([]byte(token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := sha256.Sum256([]byte(bearerToken(r)))
		if subtle.ConstantTimeCompare(provided[:], expected[:]) != 1 {
			select {
			case <-time.After(AuthFailDelay):
			case <-r.Context().Done():
			}
			writeError(w, http.StatusUnauthorized, MsgAgentUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
