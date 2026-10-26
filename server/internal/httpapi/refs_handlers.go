package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
)

type refsHandler struct {
	refs     refs.Store
	accounts accounts.Store
	intakes  intake.Store
	planner  refs.Generator
	pushes   *pushHandler
	logger   *slog.Logger
}

func (h *refsHandler) notifyWhenReady(ctx context.Context, itemID string) {
	if h.pushes == nil {
		return
	}
	masterID, err := h.refs.MasterOf(ctx, itemID)
	if err != nil {
		return
	}
	active, done, err := h.refs.Remaining(ctx, masterID)
	if err != nil || active > 0 || done == 0 {
		return
	}
	h.pushes.notify(ctx, masterID, push.Message{
		Title: PushRefsTitle, Body: PushRefsBody, URL: PushRefsURL,
		Topic: push.Topic{Kind: push.KindRefs, PlanStart: planStart(ctx, h.accounts, masterID)},
	})
}

func (h *refsHandler) order(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxRefsOrderBytes)
	var body RefsOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	items, message := cleanRefItems(body.Items)
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	added, removed, err := h.refs.Sync(r.Context(), identity.MasterID, items, time.Now())
	if err != nil {
		h.logger.Error("sync refs failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added, "removed": removed})
}

func cleanRefItems(items []refs.OrderItem) ([]refs.OrderItem, string) {
	if len(items) > refs.MaxOrderItems {
		return nil, MsgRefsTooMany
	}
	seen := make(map[string]struct{}, len(items))
	cleaned := make([]refs.OrderItem, 0, len(items))
	for _, item := range items {
		item.Key = strings.TrimSpace(item.Key)
		item.Pillar = clipRunes(strings.TrimSpace(item.Pillar), refs.MaxFieldRunes)
		item.Idea = clipRunes(strings.TrimSpace(item.Idea), refs.MaxFieldRunes)
		item.Date = strings.TrimSpace(item.Date)
		if item.Key == "" || utf8.RuneCountInString(item.Key) > refs.MaxKeyRunes || !refs.ValidFormat(item.Format) {
			return nil, MsgBadRequest
		}
		if _, err := time.Parse(refs.DateLayout, item.Date); item.Date != "" && err != nil {
			return nil, MsgBadRequest
		}
		if _, duplicate := seen[item.Key]; duplicate {
			continue
		}
		seen[item.Key] = struct{}{}
		cleaned = append(cleaned, item)
	}
	return cleaned, ""
}

func (h *refsHandler) status(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	statuses, err := h.refs.Statuses(r.Context(), identity.MasterID, time.Now())
	if err != nil {
		h.logger.Error("refs status failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}
	writeJSON(w, http.StatusOK, statuses)
}

func (h *refsHandler) made(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body RefsMadeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	err := h.refs.Confirm(r.Context(), identity.MasterID, strings.TrimSpace(body.Key))
	switch {
	case errors.Is(err, refs.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgRefsNotFound)
	case errors.Is(err, refs.ErrState):
		writeError(w, http.StatusConflict, MsgRefsBusy)
	case err != nil:
		h.logger.Error("confirm refs failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (h *refsHandler) file(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	file, err := h.refs.File(r.Context(), identity.MasterID, r.PathValue("id"))
	if errors.Is(err, refs.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgRefsNotFound)
		return
	}
	if err != nil {
		h.logger.Error("refs file failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}
	w.Header().Set("Content-Type", file.MediaType)
	w.Header().Set("Content-Length", strconv.Itoa(len(file.Data)))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(file.Data)
}

type refsAgentHandler struct {
	refsHandler
}

func (h *refsAgentHandler) next(w http.ResponseWriter, r *http.Request) {
	item, err := h.refs.Claim(r.Context(), time.Now(), refs.Lease)
	if errors.Is(err, refs.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		h.logger.Error("claim ref failed", slog.Any("error", err))
		writeError(w, http.StatusInternalServerError, MsgRefsFailed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), RequestTimeout)
	defer cancel()
	plan, err := h.planner.Generate(ctx, refs.Request{About: aboutMaster(r.Context(), h.accounts, h.intakes, item.MasterID), Item: item, Frames: framesOf(r.Context(), h.accounts, item.MasterID, item.Key)})
	if err != nil {
		final := errors.Is(err, refs.ErrRefused)
		h.logger.Error("plan refs failed", slog.Any("error", err))
		_ = h.refs.Fail(context.WithoutCancel(r.Context()), item.ID, "не удалось придумать кадры", final, time.Now())
		writeError(w, http.StatusBadGateway, MsgRefsFailed)
		return
	}
	writeJSON(w, http.StatusOK, RefAgentItem{
		ID: item.ID, Key: item.Key, Format: item.Format, Kind: refs.KindPhoto, Prompts: plan.Prompts,
	})
}

func (h *refsAgentHandler) result(w http.ResponseWriter, r *http.Request) {
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
	if len(headers) == 0 || len(headers) > refs.MaxPerItem {
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

	id := r.PathValue("id")
	if status, message := h.finish(h.refs.Complete(r.Context(), id, files, time.Now())); message != "" {
		writeError(w, status, message)
		return
	}
	h.notifyWhenReady(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]int{"files": len(files)})
}

func readRefFile(header *multipart.FileHeader, index int) (refs.File, int, string) {
	source, err := header.Open()
	if err != nil {
		return refs.File{}, http.StatusBadRequest, MsgBadRequest
	}
	data, err := io.ReadAll(io.LimitReader(source, refs.MaxFileBytes+1))
	_ = source.Close()
	if err != nil {
		return refs.File{}, http.StatusBadRequest, MsgBadRequest
	}
	if len(data) > refs.MaxFileBytes {
		return refs.File{}, http.StatusRequestEntityTooLarge, MsgTooLarge
	}
	mediaType, _, _ := strings.Cut(http.DetectContentType(data[:min(len(data), SniffLength)]), ";")
	kind, ok := refMediaKinds[mediaType]
	if !ok {
		return refs.File{}, http.StatusUnsupportedMediaType, MsgUnsupportedFile
	}
	return refs.File{Index: index, Kind: kind, MediaType: mediaType, Data: data}, 0, ""
}

var refMediaKinds = map[string]string{
	"image/png":  refs.KindPhoto,
	"image/jpeg": refs.KindPhoto,
	"image/webp": refs.KindPhoto,
}

func (h *refsAgentHandler) fail(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body AgentFailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	reason := clipRunes(strings.TrimSpace(body.Reason), MaxJobReasonRunes)
	if reason == "" {
		reason = "агент не смог сделать референсы"
	}
	id := r.PathValue("id")
	if status, message := h.finish(h.refs.Fail(r.Context(), id, reason, body.Final, time.Now())); message != "" {
		writeError(w, status, message)
		return
	}
	h.notifyWhenReady(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *refsAgentHandler) finish(err error) (int, string) {
	switch {
	case err == nil:
		return 0, ""
	case errors.Is(err, refs.ErrNotFound):
		return http.StatusNotFound, MsgRefsNotFound
	case errors.Is(err, refs.ErrState):
		return http.StatusConflict, MsgRefsState
	default:
		h.logger.Error("refs action failed", slog.Any("error", err))
		return http.StatusInternalServerError, MsgRefsFailed
	}
}
