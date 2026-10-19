package store

import (
	"context"
	"log/slog"
)

type errorHandler struct {
	inner slog.Handler
	sink  Recorder
	attrs []slog.Attr
}

func NewErrorHandler(inner slog.Handler, sink Recorder) slog.Handler {
	return &errorHandler{inner: inner, sink: sink}
}

func (h *errorHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *errorHandler) Handle(ctx context.Context, record slog.Record) error {
	if record.Level >= slog.LevelError {
		details := map[string]any{"level": record.Level.String()}
		add := func(a slog.Attr) {
			details[a.Key] = a.Value.Resolve().String()
		}
		for _, a := range h.attrs {
			add(a)
		}
		record.Attrs(func(a slog.Attr) bool {
			add(a)
			return true
		})
		h.sink.SaveError(ErrorSourceServer, record.Message, details)
	}
	return h.inner.Handle(ctx, record)
}

func (h *errorHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	merged := append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &errorHandler{inner: h.inner.WithAttrs(attrs), sink: h.sink, attrs: merged}
}

func (h *errorHandler) WithGroup(name string) slog.Handler {
	return &errorHandler{inner: h.inner.WithGroup(name), sink: h.sink, attrs: h.attrs}
}
