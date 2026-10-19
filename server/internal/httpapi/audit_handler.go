package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"

	"post-helper/server/internal/audit"
	"post-helper/server/internal/chat"
	"post-helper/server/internal/store"
	"post-helper/server/internal/strategy"
)

type auditHandler struct {
	journal   *journal
	generator audit.Generator
	recorder  store.Recorder
	logger    *slog.Logger
}

func (h *auditHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	request, status, message := h.readRequest(r)
	if message != "" {
		writeError(w, status, message)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), chat.RequestTimeout)
	defer cancel()

	result, err := h.generator.Generate(ctx, request)
	var unreadable *audit.UnreadableError
	switch {
	case errors.As(err, &unreadable):
		writeError(w, http.StatusUnprocessableEntity, MsgAuditUnreadable+unreadable.Reason)
	case errors.Is(err, audit.ErrRefused):
		writeError(w, http.StatusUnprocessableEntity, MsgAuditRefused)
	case err != nil:
		h.logger.Error("audit failed", slog.Any("error", err))
		writeError(w, http.StatusBadGateway, MsgAuditFailed)
	default:
		h.logger.Info("audit generated", slog.Int("images", len(request.Images)))
		h.recorder.SaveEvent(store.EventAudit, "", map[string]any{"images": len(request.Images)})
		h.journal.record(r, UsageAudit, map[string]any{
			"images": imageNames(request.Images),
			"result": result,
		})
		writeJSON(w, http.StatusOK, result)
	}
}

func (h *auditHandler) readRequest(r *http.Request) (audit.Request, int, string) {
	var profile strategy.Profile
	if err := json.Unmarshal([]byte(r.FormValue(FieldProfile)), &profile); err != nil {
		return audit.Request{}, http.StatusBadRequest, MsgBadRequest
	}
	profile, status, message := cleanProfile(profile)
	if message != "" {
		return audit.Request{}, status, message
	}

	images, status, message := readAuditImages(r.MultipartForm.File[FieldImages], audit.MaxImages, h.logger)
	if message != "" {
		return audit.Request{}, status, message
	}
	return audit.Request{Profile: profile, Images: images}, 0, ""
}

func imageNames(images []audit.Image) []string {
	names := make([]string, 0, len(images))
	for _, image := range images {
		names = append(names, image.Name)
	}
	return names
}

func readAuditImages(headers []*multipart.FileHeader, limit int, logger *slog.Logger) ([]audit.Image, int, string) {
	switch {
	case len(headers) == 0:
		return nil, http.StatusBadRequest, MsgNoImages
	case len(headers) > limit:
		return nil, http.StatusBadRequest, MsgTooManyImages
	}

	images := make([]audit.Image, 0, len(headers))
	for _, header := range headers {
		file, err := header.Open()
		if err != nil {
			logger.Error("open image failed", slog.Any("error", err))
			return nil, http.StatusBadRequest, MsgBadRequest
		}
		data, err := io.ReadAll(io.LimitReader(file, audit.MaxImageBytes+1))
		_ = file.Close()
		if err != nil {
			logger.Error("read image failed", slog.Any("error", err))
			return nil, http.StatusBadRequest, MsgBadRequest
		}
		if len(data) > audit.MaxImageBytes {
			return nil, http.StatusRequestEntityTooLarge, MsgTooLarge
		}
		mediaType, _, _ := strings.Cut(http.DetectContentType(data[:min(len(data), chat.SniffLength)]), ";")
		if _, ok := audit.MediaTypes[mediaType]; !ok {
			return nil, http.StatusUnsupportedMediaType, MsgUnsupportedFile
		}
		images = append(images, audit.Image{Name: header.Filename, MediaType: mediaType, Data: data})
	}
	return images, 0, ""
}
