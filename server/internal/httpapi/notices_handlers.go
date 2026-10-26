package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/media"
	"post-helper/server/internal/notices"
	"post-helper/server/internal/refs"
)

type noticesHandler struct {
	notices  notices.Store
	accounts accounts.Store
	media    media.Store
	refs     refs.Store
	location *time.Location
	logger   *slog.Logger
}

func noticeView(entry notices.Entry, verdict notices.Verdict) NoticeView {
	return NoticeView{
		ID: entry.ID, Kind: entry.Topic.Kind, Title: entry.Title, Body: entry.Body, SentAt: entry.SentAt.UTC(),
		State: verdict.State, Reason: verdict.Reason, Link: verdict.Link, MovedTo: verdict.MovedTo,
	}
}

func (h *noticesHandler) list(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	entries, err := h.notices.List(r.Context(), identity.MasterID, notices.ListLimit)
	if err != nil {
		h.problem(w, err)
		return
	}
	facts, err := h.facts(r.Context(), identity.MasterID)
	if err != nil {
		h.problem(w, err)
		return
	}
	views := make([]NoticeView, 0, len(entries))
	for _, entry := range entries {
		views = append(views, noticeView(entry, notices.Judge(entry, facts)))
	}
	writeJSON(w, http.StatusOK, views)
}

func (h *noticesHandler) get(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	entry, err := h.notices.Get(r.Context(), identity.MasterID, r.PathValue("id"))
	if errors.Is(err, notices.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgNoticeNotFound)
		return
	}
	if err != nil {
		h.problem(w, err)
		return
	}
	facts, err := h.facts(r.Context(), identity.MasterID)
	if err != nil {
		h.problem(w, err)
		return
	}
	writeJSON(w, http.StatusOK, noticeView(entry, notices.Judge(entry, facts)))
}

func (h *noticesHandler) facts(ctx context.Context, masterID string) (notices.Facts, error) {
	now := time.Now()
	facts := notices.Facts{MediaDone: map[string]bool{}}
	state, err := h.accounts.LoadState(ctx, masterID)
	if err != nil && !errors.Is(err, accounts.ErrNotFound) {
		return facts, err
	}
	facts.Plan, facts.HasPlan = notices.PlanOf(state.Data)
	items, err := h.media.List(ctx, masterID)
	if err != nil {
		return facts, err
	}
	for _, item := range items {
		if item.Status == media.StatusDone {
			facts.MediaDone[item.Key] = true
		}
	}
	statuses, err := h.refs.Statuses(ctx, masterID, now)
	if err != nil {
		return facts, err
	}
	for _, status := range statuses {
		if (status.Status == refs.StatusDone || status.Status == refs.StatusMade) && len(status.Files) > 0 {
			facts.RefsReady = true
		}
	}
	facts.Today = now.In(h.locationOf(ctx, masterID)).Format(notices.DateLayout)
	return facts, nil
}

func (h *noticesHandler) locationOf(ctx context.Context, masterID string) *time.Location {
	master, err := h.accounts.GetMaster(ctx, masterID)
	if err == nil && master.Timezone != "" {
		if location, err := time.LoadLocation(master.Timezone); err == nil {
			return location
		}
	}
	return h.location
}

func (h *noticesHandler) problem(w http.ResponseWriter, err error) {
	h.logger.Error("notification history failed", slog.Any("error", err))
	writeError(w, http.StatusInternalServerError, MsgNoticesFailed)
}

func planStart(ctx context.Context, people accounts.Store, masterID string) string {
	state, err := people.LoadState(ctx, masterID)
	if err != nil {
		return ""
	}
	calendar, _ := notices.PlanOf(state.Data)
	return calendar.StartedOn
}
