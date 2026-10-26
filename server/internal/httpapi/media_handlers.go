package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/media"
	"post-helper/server/internal/push"
)

var unsafeFileNameChars = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

type mediaHandler struct {
	media    media.Store
	files    media.Files
	planner  media.Planner
	accounts accounts.Store
	intakes  intake.Store
	pushes   *pushHandler
	logger   *slog.Logger
}

func mediaView(item media.Item) MediaStatus {
	view := MediaStatus{
		ID: item.ID, Key: item.Key, Unit: item.Unit, Note: item.Note, Kind: item.Kind, Format: item.Format, Status: item.Status,
		CreatedAt: item.CreatedAt.UTC(), Source: item.Source,
	}
	if item.Status == media.StatusFailed || item.Status == media.StatusDone {
		view.Error = item.Error
	}
	view.Wish, view.Redos = item.Wish, item.Redos
	view.CanRedo = item.Status == media.StatusDone && item.SourceRef != "" && item.Redos < media.MaxRedos
	if item.Status == media.StatusDone {
		finished := item.FinishedAt.UTC()
		result := item.Result
		result.Caption = item.Caption
		result.Thumb = item.ThumbRef != "" || result.Type == media.ResultPhotoType
		view.FinishedAt, view.Result = &finished, &result
	}
	return view
}

func (h *mediaHandler) notifyWhenReady(ctx context.Context, itemID string) {
	if h.pushes == nil {
		return
	}
	masterID, err := h.media.MasterOf(ctx, itemID)
	if err != nil {
		return
	}
	active, done, err := h.media.Remaining(ctx, masterID)
	if err != nil || active > 0 || done == 0 {
		return
	}
	h.pushes.notify(ctx, masterID, push.Message{
		Title: PushMediaTitle, Body: PushMediaBody, URL: PushMediaURL,
		Topic: push.Topic{Kind: push.KindMedia, PlanStart: planStart(ctx, h.accounts, masterID), ItemIDs: h.readyKeys(ctx, masterID)},
	})
}

func (h *mediaHandler) readyKeys(ctx context.Context, masterID string) []string {
	items, err := h.media.List(ctx, masterID)
	if err != nil {
		return nil
	}
	var keys []string
	for _, item := range items {
		if item.Status == media.StatusDone && !slices.Contains(keys, item.Key) {
			keys = append(keys, item.Key)
		}
	}
	return keys
}

func (h *mediaHandler) dropFiles(ctx context.Context, refs ...string) {
	if err := h.files.Delete(context.WithoutCancel(ctx), refs...); err != nil {
		h.logger.Error("delete media files failed", slog.Any("error", err))
	}
}

func (h *mediaHandler) problem(w http.ResponseWriter, status int, message string, err error) {
	if err != nil {
		h.logger.Error("media action failed", slog.Any("error", err))
	}
	writeError(w, status, message)
}

func parseMediaForm(w http.ResponseWriter, r *http.Request, limit int64, logger *slog.Logger) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := r.ParseMultipartForm(MaxFormMemory); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
			return false
		}
		logger.Warn("media form rejected",
			slog.String("path", r.URL.Path),
			slog.Int64("length", r.ContentLength),
			slog.String("type", r.Header.Get("Content-Type")),
			slog.String("agent", r.UserAgent()),
			slog.Any("error", err))
		writeError(w, http.StatusBadRequest, MsgMediaBadForm)
		return false
	}
	return true
}

func sniffType(file multipart.File) (string, error) {
	buffer := make([]byte, SniffLength)
	read, err := io.ReadFull(file, buffer)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	mediaType, _, _ := strings.Cut(http.DetectContentType(buffer[:read]), ";")
	return mediaType, nil
}

func cleanUploadMeta(meta MediaUploadMeta) (MediaUploadMeta, bool) {
	meta.Key = strings.TrimSpace(meta.Key)
	if meta.Key == "" || utf8.RuneCountInString(meta.Key) > media.MaxKeyRunes || !media.ValidFormat(meta.Format) {
		return meta, false
	}
	meta.Unit = clipRunes(strings.TrimSpace(meta.Unit), media.MaxUnitRunes)
	meta.Pillar = clipRunes(strings.TrimSpace(meta.Pillar), media.MaxFieldRunes)
	meta.Idea = clipRunes(strings.TrimSpace(meta.Idea), media.MaxFieldRunes)
	meta.Overlay = clipRunes(strings.TrimSpace(meta.Overlay), media.MaxOverlayRunes)
	meta.Note = clipRunes(strings.TrimSpace(meta.Note), media.MaxMasterNote)
	return meta, true
}

func (h *mediaHandler) upload(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	existing, err := h.media.List(r.Context(), identity.MasterID)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	if len(existing) >= media.MaxPerMaster {
		writeError(w, http.StatusConflict, MsgMediaTooMany)
		return
	}
	if !parseMediaForm(w, r, MaxMediaUploadBytes, h.logger) {
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	var meta MediaUploadMeta
	if err := json.Unmarshal([]byte(r.FormValue(FieldData)), &meta); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	meta, ok := cleanUploadMeta(meta)
	if !ok {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	headers := r.MultipartForm.File[FieldFile]
	if len(headers) != 1 {
		writeError(w, http.StatusBadRequest, MsgMediaNoFile)
		return
	}
	header := headers[0]
	if header.Size == 0 {
		h.logger.Warn("media upload is empty", slog.String("name", header.Filename), slog.String("agent", r.UserAgent()))
		writeError(w, http.StatusBadRequest, MsgMediaEmptyFile)
		return
	}
	if header.Size > media.MaxSourceBytes {
		writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
		return
	}
	mediaType := media.ResolveType(header.Header.Get("Content-Type"), header.Filename)
	kind, supported := media.KindOf(mediaType)
	if !supported {
		writeError(w, http.StatusUnsupportedMediaType, MsgUnsupportedFile)
		return
	}
	source, err := header.Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	defer func() { _ = source.Close() }()

	id := media.NewID()
	ref := media.RefOf(identity.MasterID, id, "source", mediaType)
	size, err := h.files.Put(r.Context(), ref, source, media.MaxSourceBytes)
	if errors.Is(err, media.ErrFileTooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	item := media.Item{
		ID: id, MasterID: identity.MasterID, Key: meta.Key, Unit: meta.Unit, Kind: kind, Format: meta.Format,
		Pillar: meta.Pillar, Idea: meta.Idea, Overlay: meta.Overlay, Note: meta.Note, Status: media.StatusQueued, CreatedAt: time.Now(),
		Source:    media.Source{Name: clipRunes(filepath.Base(header.Filename), media.MaxNameRunes), Type: mediaType, Size: size},
		SourceRef: ref,
	}
	if err := h.media.Create(r.Context(), item, media.MaxPerMaster); err != nil {
		h.dropFiles(r.Context(), ref)
		if errors.Is(err, media.ErrTooMany) {
			writeError(w, http.StatusConflict, MsgMediaTooMany)
			return
		}
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	writeJSON(w, http.StatusOK, mediaView(item))
}

func (h *mediaHandler) status(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	items, err := h.media.List(r.Context(), identity.MasterID)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	views := make([]MediaStatus, 0, len(items))
	for _, item := range items {
		views = append(views, mediaView(item))
	}
	writeJSON(w, http.StatusOK, views)
}

func (h *mediaHandler) doneItem(w http.ResponseWriter, r *http.Request) (media.Item, bool) {
	identity, _ := auth.FromContext(r.Context())
	item, err := h.media.Get(r.Context(), identity.MasterID, r.PathValue("id"))
	if errors.Is(err, media.ErrNotFound) || err == nil && (item.Status != media.StatusDone || item.ResultRef == "") {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return media.Item{}, false
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return media.Item{}, false
	}
	return item, true
}

func (h *mediaHandler) serve(w http.ResponseWriter, r *http.Request, ref, mediaType, fileName string, modified time.Time) {
	file, _, err := h.files.Open(r.Context(), ref)
	if errors.Is(err, media.ErrNoFile) {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	defer func() { _ = file.Close() }()
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Cache-Control", MediaCacheControl)
	w.Header().Set("X-Content-Type-Options", MediaNoSniff)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, fileName))
	http.ServeContent(w, r, "", modified, file)
}

func (h *mediaHandler) file(w http.ResponseWriter, r *http.Request) {
	item, ok := h.doneItem(w, r)
	if !ok {
		return
	}
	siblings, err := h.media.List(r.Context(), item.MasterID)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	h.serve(w, r, item.ResultRef, item.Result.Type, resultFileName(item, siblings), item.FinishedAt)
}

func (h *mediaHandler) thumb(w http.ResponseWriter, r *http.Request) {
	item, ok := h.doneItem(w, r)
	if !ok {
		return
	}
	ref := item.ThumbRef
	if ref == "" && item.Result.Type == media.ResultPhotoType {
		ref = item.ResultRef
	}
	if ref == "" {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	h.serve(w, r, ref, media.PreviewMediaType, "thumb.jpg", item.FinishedAt)
}

func resultFileName(item media.Item, siblings []media.Item) string {
	index := 1
	for _, sibling := range siblings {
		if sibling.ID == item.ID {
			break
		}
		if sibling.Key == item.Key {
			index++
		}
	}
	key := strings.Trim(unsafeFileNameChars.ReplaceAllString(item.Key, "_"), "_")
	if key == "" {
		key = "media"
	}
	return key + "-" + strconv.Itoa(index) + media.Extension(item.Result.Type)
}

func (h *mediaHandler) remove(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	item, err := h.media.Remove(r.Context(), identity.MasterID, r.PathValue("id"))
	if errors.Is(err, media.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	h.dropFiles(r.Context(), item.SourceRef, item.ResultRef, item.ThumbRef)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *mediaHandler) redo(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, MaxPushBodyBytes)
	var body MediaRedoRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	wish := clipRunes(strings.TrimSpace(body.Wish), media.MaxWishRunes)
	item, err := h.media.Redo(r.Context(), identity.MasterID, r.PathValue("id"), wish)
	switch {
	case errors.Is(err, media.ErrNotFound):
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
	case errors.Is(err, media.ErrRedoLimit):
		writeError(w, http.StatusConflict, MsgMediaRedoLimit)
	case errors.Is(err, media.ErrState):
		writeError(w, http.StatusConflict, MsgMediaNoSource)
	case err != nil:
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
	default:
		writeJSON(w, http.StatusOK, mediaView(item))
	}
}

type mediaAgentHandler struct {
	mediaHandler
}

func (h *mediaAgentHandler) running(w http.ResponseWriter, r *http.Request, otherState int, otherMessage string) (media.Item, bool) {
	item, err := h.media.Find(r.Context(), r.PathValue("id"))
	if errors.Is(err, media.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return media.Item{}, false
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return media.Item{}, false
	}
	if item.Status != media.StatusRunning {
		writeError(w, otherState, otherMessage)
		return media.Item{}, false
	}
	return item, true
}

func (h *mediaAgentHandler) next(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	stale, err := h.media.Expire(r.Context(), now, media.Lease)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	h.dropFiles(r.Context(), stale...)
	item, err := h.media.Claim(r.Context(), now, media.Lease)
	if errors.Is(err, media.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	writeJSON(w, http.StatusOK, AgentMediaItem{
		ID: item.ID, Key: item.Key, Unit: item.Unit, Kind: item.Kind, Format: item.Format,
		SourceType: item.Source.Type, SourceName: item.Source.Name, SourceSize: item.Source.Size,
		Idea: item.Idea, Pillar: item.Pillar, Overlay: item.Overlay, Note: item.Note, Attempts: item.Attempts,
	})
}

func (h *mediaAgentHandler) source(w http.ResponseWriter, r *http.Request) {
	item, ok := h.running(w, r, http.StatusNotFound, MsgMediaNotFound)
	if !ok {
		return
	}
	if item.SourceRef == "" {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	file, _, err := h.files.Open(r.Context(), item.SourceRef)
	if errors.Is(err, media.ErrNoFile) {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	defer func() { _ = file.Close() }()
	w.Header().Set("Content-Type", item.Source.Type)
	http.ServeContent(w, r, "", time.Time{}, file)
}

func (h *mediaAgentHandler) plan(w http.ResponseWriter, r *http.Request) {
	item, ok := h.running(w, r, http.StatusNotFound, MsgMediaNotFound)
	if !ok {
		return
	}
	if !parseMediaForm(w, r, MaxMediaPlanBytes, h.logger) {
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	var body MediaPlanRequest
	if raw := r.FormValue(FieldData); raw != "" {
		if err := json.Unmarshal([]byte(raw), &body); err != nil {
			writeError(w, http.StatusBadRequest, MsgBadRequest)
			return
		}
	}
	segments := media.CleanSegments(body.Segments)
	var preview []byte
	if headers := r.MultipartForm.File[FieldPreview]; len(headers) > 0 {
		if headers[0].Size > media.MaxPreviewBytes {
			writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
			return
		}
		data, status := readPart(headers[0], media.MaxPreviewBytes)
		if status != 0 {
			writeError(w, status, MsgBadRequest)
			return
		}
		if mediaType, _, _ := strings.Cut(http.DetectContentType(data[:min(len(data), SniffLength)]), ";"); mediaType == media.PreviewMediaType {
			preview = data
		}
	}
	plan := media.DefaultPlan(segments, item.Note)
	if h.planner != nil {
		ctx, cancel := context.WithTimeout(r.Context(), media.PlanTimeout)
		made, err := h.planner.Plan(ctx, media.Request{
			About: aboutMaster(ctx, h.accounts, h.intakes, item.MasterID), Item: item,
			Width: max(body.Width, 0), Height: max(body.Height, 0), DurationMs: max(body.DurationMs, 0),
			Segments: segments, Preview: preview,
		})
		cancel()
		if err != nil {
			h.logger.Error("plan media failed", slog.Any("error", err))
		} else {
			plan = made
		}
	}
	plan.Caption = clipRunes(strings.TrimSpace(plan.Caption), media.MaxCaptionRunes)
	if strings.TrimSpace(item.Note) == "" {
		plan.Caption = ""
	}
	if err := h.media.SetCaption(r.Context(), item.ID, plan.Caption); err != nil && !errors.Is(err, media.ErrNotFound) {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func readPart(header *multipart.FileHeader, limit int64) ([]byte, int) {
	file, err := header.Open()
	if err != nil {
		return nil, http.StatusBadRequest
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, http.StatusBadRequest
	}
	if int64(len(data)) > limit {
		return nil, http.StatusRequestEntityTooLarge
	}
	return data, 0
}

func (h *mediaAgentHandler) finish(err error) (int, string) {
	switch {
	case err == nil:
		return 0, ""
	case errors.Is(err, media.ErrNotFound):
		return http.StatusNotFound, MsgMediaNotFound
	case errors.Is(err, media.ErrState):
		return http.StatusConflict, MsgMediaState
	default:
		h.logger.Error("media action failed", slog.Any("error", err))
		return http.StatusInternalServerError, MsgMediaFailed
	}
}

func (h *mediaAgentHandler) result(w http.ResponseWriter, r *http.Request) {
	item, ok := h.running(w, r, http.StatusConflict, MsgMediaState)
	if !ok {
		return
	}
	if !parseMediaForm(w, r, MaxMediaResultBytes, h.logger) {
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	var body MediaResultRequest
	if raw := r.FormValue(FieldData); raw != "" {
		if err := json.Unmarshal([]byte(raw), &body); err != nil {
			writeError(w, http.StatusBadRequest, MsgBadRequest)
			return
		}
	}
	headers := r.MultipartForm.File[FieldFile]
	if len(headers) != 1 {
		writeError(w, http.StatusBadRequest, MsgMediaNoFile)
		return
	}
	if headers[0].Size > media.MaxResultBytes {
		writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
		return
	}
	file, err := headers[0].Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	defer func() { _ = file.Close() }()
	resultType, err := sniffType(file)
	want := media.ResultVideoType
	if item.Kind == media.KindPhoto {
		want = media.ResultPhotoType
	}
	if err != nil || resultType != want {
		writeError(w, http.StatusUnsupportedMediaType, MsgMediaBadResult)
		return
	}
	var thumbData []byte
	if thumbHeaders := r.MultipartForm.File[FieldThumb]; len(thumbHeaders) > 0 {
		data, status := readPart(thumbHeaders[0], media.MaxThumbBytes)
		if status != 0 {
			message := MsgBadRequest
			if status == http.StatusRequestEntityTooLarge {
				message = MsgTooLarge
			}
			writeError(w, status, message)
			return
		}
		if thumbType, _, _ := strings.Cut(http.DetectContentType(data[:min(len(data), SniffLength)]), ";"); thumbType != media.PreviewMediaType {
			writeError(w, http.StatusUnsupportedMediaType, MsgMediaBadResult)
			return
		}
		thumbData = data
	}

	resultRef := media.RefOf(item.MasterID, item.ID, "result", resultType)
	size, err := h.files.Put(r.Context(), resultRef, file, media.MaxResultBytes)
	if errors.Is(err, media.ErrFileTooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, MsgTooLarge)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	thumbRef := ""
	if len(thumbData) > 0 {
		thumbRef = media.RefOf(item.MasterID, item.ID, "thumb", media.PreviewMediaType)
		if _, err := h.files.Put(r.Context(), thumbRef, bytes.NewReader(thumbData), media.MaxThumbBytes); err != nil {
			h.dropFiles(r.Context(), resultRef)
			h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
			return
		}
	}
	note := clipRunes(strings.TrimSpace(body.Note), media.MaxNoteRunes)
	if note == "" {
		note = media.DefaultNote
	}
	result := media.Result{
		Type: resultType, Size: size, Width: max(body.Width, 0), Height: max(body.Height, 0),
		DurationMs: max(body.DurationMs, 0), Subtitled: body.Subtitled && item.Kind == media.KindVideo,
		Thumb: thumbRef != "" || resultType == media.ResultPhotoType, Note: note,
	}
	err = h.media.Complete(r.Context(), item.ID, result, resultRef, thumbRef, time.Now())
	if status, message := h.finish(err); message != "" {
		h.dropFiles(r.Context(), resultRef, thumbRef)
		writeError(w, status, message)
		return
	}
	var stale []string
	for _, ref := range []string{item.ResultRef, item.ThumbRef} {
		if ref != "" && ref != resultRef && ref != thumbRef {
			stale = append(stale, ref)
		}
	}
	h.dropFiles(r.Context(), stale...)
	h.notifyWhenReady(r.Context(), item.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *mediaAgentHandler) fail(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body AgentFailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	reason := clipRunes(strings.TrimSpace(body.Reason), media.MaxErrorRunes)
	if reason == "" {
		reason = media.DefaultFailReason
	}
	id := r.PathValue("id")
	sourceRef, err := h.media.Fail(r.Context(), id, reason, body.Final, time.Now())
	if status, message := h.finish(err); message != "" {
		writeError(w, status, message)
		return
	}
	h.dropFiles(r.Context(), sourceRef)
	h.notifyWhenReady(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *mediaAgentHandler) adminFile(w http.ResponseWriter, r *http.Request) {
	item, err := h.media.Find(r.Context(), r.PathValue("id"))
	if errors.Is(err, media.ErrNotFound) {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	if r.URL.Query().Get(MediaFileQuery) == MediaFileSource {
		if item.SourceRef == "" {
			writeError(w, http.StatusNotFound, MsgMediaNotFound)
			return
		}
		h.serve(w, r, item.SourceRef, item.Source.Type, "source"+media.Extension(item.Source.Type), item.CreatedAt)
		return
	}
	if item.Status != media.StatusDone || item.ResultRef == "" {
		writeError(w, http.StatusNotFound, MsgMediaNotFound)
		return
	}
	siblings, err := h.media.List(r.Context(), item.MasterID)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	h.serve(w, r, item.ResultRef, item.Result.Type, resultFileName(item, siblings), item.FinishedAt)
}

func (h *mediaAgentHandler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.media.Recent(r.Context(), media.MaxAdminList)
	if err != nil {
		h.problem(w, http.StatusInternalServerError, MsgMediaFailed, err)
		return
	}
	views := make([]MediaAdminStatus, 0, len(items))
	for _, item := range items {
		views = append(views, MediaAdminStatus{MediaStatus: mediaView(item), MasterID: item.MasterID})
	}
	writeJSON(w, http.StatusOK, views)
}
