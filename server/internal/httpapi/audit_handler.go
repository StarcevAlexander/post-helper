package httpapi

import (
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"

	"post-helper/server/internal/audit"
	"post-helper/server/internal/chat"
)

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
