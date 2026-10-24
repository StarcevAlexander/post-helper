package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
)

type meHandler struct {
	retentionDays int
	accounts      accounts.Store
	dailyLimit    int
	logger        *slog.Logger
}

func (h *meHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	response := MeResponse{Role: "master", Name: identity.Name, DailyLimit: h.dailyLimit, RetentionDays: h.retentionDays}
	if identity.Admin {
		response.Role = "admin"
		writeJSON(w, http.StatusOK, response)
		return
	}
	used, err := h.accounts.CountUsage(r.Context(), identity.MasterID, dayStart(time.Now()))
	if err != nil {
		h.logger.Error("count usage failed", slog.Any("error", err))
	}
	response.UsageToday = used
	providers, err := h.accounts.Providers(r.Context(), identity.MasterID)
	if err != nil {
		h.logger.Error("list providers failed", slog.Any("error", err))
	}
	response.Providers = providers
	writeJSON(w, http.StatusOK, response)
}

type renameHandler struct {
	accounts accounts.Store
	logger   *slog.Logger
}

func (h *renameHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body RenameRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	name := strings.TrimSpace(body.Name)
	switch {
	case name == "":
		writeError(w, http.StatusBadRequest, MsgNoMasterName)
		return
	case utf8.RuneCountInString(name) > MaxMasterNameRunes:
		writeError(w, http.StatusBadRequest, MsgMasterNameTooLong)
		return
	}
	switch err := h.accounts.RenameMaster(r.Context(), identity.MasterID, name); {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgRenameFailed)
	case err != nil:
		h.logger.Error("rename master failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRenameFailed)
	default:
		writeJSON(w, http.StatusOK, RenameRequest{Name: name})
	}
}

type stateHandler struct {
	accounts accounts.Store
	logger   *slog.Logger
}

func (h *stateHandler) get(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	state, err := h.accounts.LoadState(r.Context(), identity.MasterID)
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeJSON(w, http.StatusOK, accounts.State{})
	case err != nil:
		h.logger.Error("load state failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgStateFailed)
	default:
		writeJSON(w, http.StatusOK, state)
	}
}

func (h *stateHandler) put(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxStateBodyBytes)
	var body StateRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.BaseVersion < 0 || !isJSONObject(body.Data) {
		writeError(w, http.StatusBadRequest, MsgBadState)
		return
	}

	saved, err := h.accounts.SaveState(r.Context(), identity.MasterID, body.BaseVersion, body.Data, time.Now())
	switch {
	case errors.Is(err, accounts.ErrConflict):
		writeJSON(w, http.StatusConflict, StateConflictResponse{Error: MsgStateConflict, State: saved})
	case err != nil:
		h.logger.Error("save state failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgStateFailed)
	default:
		writeJSON(w, http.StatusOK, saved)
	}
}

func isJSONObject(data json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(data))
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(data, &object) == nil
}

type adminHandler struct {
	accounts accounts.Store
	logger   *slog.Logger
}

func (h *adminHandler) list(w http.ResponseWriter, r *http.Request) {
	masters, err := h.accounts.ListMasters(r.Context(), dayStart(time.Now()))
	if err != nil {
		h.logger.Error("list masters failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
		return
	}
	writeJSON(w, http.StatusOK, masters)
}

func (h *adminHandler) create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body CreateMasterRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	name := strings.TrimSpace(body.Name)
	switch {
	case name == "":
		writeError(w, http.StatusBadRequest, MsgNoMasterName)
		return
	case utf8.RuneCountInString(name) > MaxMasterNameRunes:
		writeError(w, http.StatusBadRequest, MsgMasterNameTooLong)
		return
	}

	code, err := auth.GenerateCode()
	if err != nil {
		h.logger.Error("generate code failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
		return
	}
	master, err := h.accounts.CreateMaster(r.Context(), name, auth.HashCode(code))
	if err != nil {
		h.logger.Error("create master failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
		return
	}
	writeJSON(w, http.StatusOK, CreateMasterResponse{Master: master, Code: code})
}

func (h *adminHandler) disable(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body DisabledRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	err := h.accounts.SetDisabled(r.Context(), r.PathValue("id"), body.Disabled)
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgMasterFailed)
	case err != nil:
		h.logger.Error("disable master failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
	default:
		writeJSON(w, http.StatusOK, DisabledRequest{Disabled: body.Disabled})
	}
}

func (h *adminHandler) events(w http.ResponseWriter, r *http.Request) {
	limit := limitParam(r.URL.Query().Get(QueryLimit))
	if limit > MaxEventsLimit {
		limit = MaxEventsLimit
	}
	events, err := h.accounts.ListEvents(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		h.logger.Error("list events failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (h *adminHandler) versions(w http.ResponseWriter, r *http.Request) {
	limit := limitParam(r.URL.Query().Get(QueryLimit))
	if limit > MaxEventsLimit {
		limit = MaxEventsLimit
	}
	versions, err := h.accounts.StateVersions(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		h.logger.Error("list versions failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

func (h *adminHandler) export(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	export, err := h.accounts.ExportMaster(r.Context(), id)
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgMasterFailed)
	case err != nil:
		h.logger.Error("export master failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
	default:
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="`+ExportFileNameFormat+`"`, id))
		writeJSON(w, http.StatusOK, export)
	}
}

func (h *adminHandler) deleteMaster(w http.ResponseWriter, r *http.Request) {
	err := h.accounts.DeleteMaster(r.Context(), r.PathValue("id"))
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgMasterFailed)
	case err != nil:
		h.logger.Error("delete master failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgMasterFailed)
	default:
		h.logger.Info("master deleted", slog.String("id", r.PathValue("id")))
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
	}
}

func (h *adminHandler) restore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body RestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Version <= 0 {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	id := r.PathValue("id")
	snapshot, err := h.accounts.StateSnapshot(r.Context(), id, body.Version)
	if errors.Is(err, accounts.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgNoVersion)
		return
	}
	if err != nil {
		h.logger.Error("load snapshot failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRestoreFailed)
		return
	}
	current, err := h.accounts.LoadState(r.Context(), id)
	if err != nil && !errors.Is(err, accounts.ErrNotFound) {
		h.logger.Error("load state failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRestoreFailed)
		return
	}
	saved, err := h.accounts.SaveState(r.Context(), id, current.Version, snapshot.Data, time.Now())
	if err != nil {
		h.logger.Error("restore state failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRestoreFailed)
		return
	}
	payload, _ := json.Marshal(map[string]int{"fromVersion": body.Version, "newVersion": saved.Version})
	if err := h.accounts.RecordEvent(r.Context(), id, UsageAdminRestore, payload, time.Now()); err != nil {
		h.logger.Error("record restore failed", slog.Any("error", err))
	}
	writeJSON(w, http.StatusOK, saved)
}
