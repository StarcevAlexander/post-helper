package notices

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"post-helper/server/internal/push"
)

type Recorder struct {
	Sender push.Sender
	Store  Store
	Logger *slog.Logger
	Now    func() time.Time
}

func (r *Recorder) PublicKey() string {
	return r.Sender.PublicKey()
}

func (r *Recorder) Send(ctx context.Context, masterID string, message push.Message) (int, error) {
	entry := Entry{
		MasterID: masterID,
		Title:    message.Title,
		Body:     message.Body,
		URL:      message.URL,
		Topic:    message.Topic,
	}
	id, idErr := NewID()
	if idErr == nil {
		entry.ID = id
		message.URL = OpenURLPrefix + id
	}
	sent, err := r.Sender.Send(ctx, masterID, message)
	if err != nil || sent == 0 {
		return sent, err
	}
	entry.Delivered, entry.SentAt = sent, r.now()
	err = idErr
	if err == nil {
		err = r.Store.Add(context.WithoutCancel(ctx), entry)
	}
	if err != nil {
		r.Logger.Error("record notification failed", slog.String("master", masterID), slog.Any("error", err))
	}
	return sent, nil
}

func (r *Recorder) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func NewID() (string, error) {
	raw := make([]byte, IDBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
