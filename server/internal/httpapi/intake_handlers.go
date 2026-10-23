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
	"post-helper/server/internal/intake"
	"post-helper/server/internal/plan"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
)

type intakeHandler struct {
	intake   intake.Store
	accounts accounts.Store
	refs     refs.Store
	notifier intake.Notifier
	pushes   *pushHandler
	logger   *slog.Logger
}

func (h *intakeHandler) submit(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxIntakeBodyBytes)
	var body IntakeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	draft, err := intake.Clean(body.Links, body.References, body.Goals, body.Note)
	if message := intakeMessage(err); message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}

	request, updated, err := h.intake.Submit(r.Context(), identity.MasterID, draft, time.Now())
	if err != nil {
		h.logger.Error("submit intake failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgIntakeFailed)
		return
	}
	h.announce(r.Context(), request, identity.Name, updated)
	writeJSON(w, http.StatusOK, request)
}

func (h *intakeHandler) announce(ctx context.Context, request intake.Request, masterName string, updated bool) {
	if h.notifier == nil {
		h.logger.Warn("intake notifier is not configured: the owner will not be notified")
		return
	}
	text := intake.Announcement(request, masterName, updated)
	go func() {
		notifyCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), intake.TelegramTimeout)
		defer cancel()
		if err := h.notifier.Notify(notifyCtx, text); err != nil {
			h.logger.Error("notify owner failed", slog.Any("error", err))
		}
	}()
}

func (h *intakeHandler) latest(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	request, err := h.intake.Latest(r.Context(), identity.MasterID)
	switch {
	case errors.Is(err, intake.ErrNotFound):
		w.WriteHeader(http.StatusNoContent)
	case err != nil:
		h.logger.Error("load intake failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgIntakeFailed)
	default:
		writeJSON(w, http.StatusOK, request)
	}
}

func (h *intakeHandler) list(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get(QueryStatus)
	if status != "" && status != intake.StatusNew && status != intake.StatusReady {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	requests, err := h.intake.List(r.Context(), status, limitParam(r.URL.Query().Get(QueryLimit)))
	if err != nil {
		h.logger.Error("list intakes failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgIntakeFailed)
		return
	}
	names := map[string]string{}
	if masters, err := h.accounts.ListMasters(r.Context(), time.Now()); err == nil {
		for _, master := range masters {
			names[master.ID] = master.Name
		}
	}
	for index := range requests {
		requests[index].MasterName = names[requests[index].MasterID]
		for _, goal := range requests[index].Goals {
			requests[index].GoalTitles = append(requests[index].GoalTitles, intake.GoalLabel(goal))
		}
	}
	writeJSON(w, http.StatusOK, requests)
}

func (h *intakeHandler) deliverPlan(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	r.Body = http.MaxBytesReader(w, r.Body, MaxPlanBodyBytes)
	var submission plan.Submission
	if err := json.NewDecoder(r.Body).Decode(&submission); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadPlan)
		return
	}

	current, err := h.accounts.LoadState(r.Context(), id)
	if err != nil && !errors.Is(err, accounts.ErrNotFound) {
		h.logger.Error("load state for plan failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgPlanFailed)
		return
	}
	merged, err := plan.Merge(current.Data, submission)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := h.accounts.SaveState(r.Context(), id, current.Version, merged.Data, time.Now())
	switch {
	case errors.Is(err, accounts.ErrConflict):
		writeError(w, http.StatusConflict, MsgStateConflict)
		return
	case err != nil:
		h.logger.Error("save plan failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgPlanFailed)
		return
	}

	note := strings.TrimSpace(submission.Note)
	if err := h.intake.Ready(r.Context(), id, note, time.Now()); err != nil && !errors.Is(err, intake.ErrNotFound) {
		h.logger.Error("mark intake ready failed", slog.Any("error", err))
	}
	payload, _ := json.Marshal(map[string]any{"version": saved.Version, "items": len(merged.Items)})
	if err := h.accounts.RecordEvent(r.Context(), id, EventPlanDelivered, payload, time.Now()); err != nil {
		h.logger.Error("record plan event failed", slog.Any("error", err))
	}
	if h.pushes != nil {
		h.pushes.notify(r.Context(), id, push.Message{Title: PushPlanTitle, Body: PushPlanBody, URL: PushPlanURL})
	}
	writeJSON(w, http.StatusOK, map[string]int{"version": saved.Version, "items": len(merged.Items)})
}

func (h *intakeHandler) deliverRefs(w http.ResponseWriter, r *http.Request) {
	masterID, key := r.PathValue("id"), r.PathValue("key")
	item, ok := h.calendarItem(r.Context(), masterID, key)
	if !ok {
		writeError(w, http.StatusNotFound, MsgRefsNoItem)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxRefsResultBytes)
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

	var captions []string
	if raw := r.FormValue(FieldData); raw != "" {
		if err := json.Unmarshal([]byte(raw), &captions); err != nil {
			writeError(w, http.StatusBadRequest, MsgBadRequest)
			return
		}
	}
	headers := r.MultipartForm.File[FieldFiles]
	if len(headers) == 0 || len(headers) > refs.PerItem {
		writeError(w, http.StatusBadRequest, MsgRefsFiles)
		return
	}
	files := make([]refs.File, 0, len(headers))
	for index, header := range headers {
		file, status, message := readRefFile(header, index)
		if message != "" {
			writeError(w, status, message)
			return
		}
		if index < len(captions) {
			file.Caption = clipRunes(strings.TrimSpace(captions[index]), refs.MaxCaptionRunes)
		}
		files = append(files, file)
	}

	order := refs.OrderItem{Key: item.ID, Format: item.Format, Pillar: item.Pillar, Idea: item.Idea, Date: item.Date}
	if err := h.refs.Deliver(r.Context(), masterID, order, files, time.Now()); err != nil {
		h.logger.Error("deliver refs failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"files": len(files)})
}

func (h *intakeHandler) clearRefs(w http.ResponseWriter, r *http.Request) {
	if err := h.refs.DeleteMaster(r.Context(), r.PathValue("id")); err != nil {
		h.logger.Error("clear refs failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *intakeHandler) calendarItem(ctx context.Context, masterID, key string) (plan.Item, bool) {
	state, err := h.accounts.LoadState(ctx, masterID)
	if err != nil {
		return plan.Item{}, false
	}
	var stored struct {
		Calendar plan.Calendar `json:"calendar"`
	}
	if json.Unmarshal(state.Data, &stored) != nil {
		return plan.Item{}, false
	}
	for _, item := range stored.Calendar.Items {
		if item.ID == key {
			return item, true
		}
	}
	return plan.Item{}, false
}

func intakeMessage(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, intake.ErrNoNetworks):
		return MsgIntakeNoLinks
	case errors.Is(err, intake.ErrTooMany):
		return MsgIntakeTooManyLinks
	case errors.Is(err, intake.ErrTooManyRef):
		return MsgIntakeTooManyRefs
	case errors.Is(err, intake.ErrBadLink):
		return MsgIntakeBadLink
	case errors.Is(err, intake.ErrBadGoal):
		return MsgIntakeBadGoal
	case errors.Is(err, intake.ErrNoGoals):
		return MsgIntakeNoGoals
	case errors.Is(err, intake.ErrLongText):
		return MsgIntakeLongNote
	default:
		return MsgBadRequest
	}
}
