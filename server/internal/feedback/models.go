package feedback

import (
	"context"
	"errors"
	"time"
)

const (
	MaxTextRunes    = 2000
	MaxContactRunes = 200
	MaxPerHour      = 5
)

var (
	ErrEmptyText   = errors.New("feedback text is empty")
	ErrLongText    = errors.New("feedback text is too long")
	ErrLongContact = errors.New("feedback contact is too long")
)

type Message struct {
	ID         string    `json:"id"`
	MasterID   string    `json:"masterId"`
	MasterName string    `json:"masterName"`
	Email      string    `json:"email,omitempty"`
	Contact    string    `json:"contact,omitempty"`
	Text       string    `json:"text"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Store interface {
	Add(ctx context.Context, message Message) (Message, error)
	CountSince(ctx context.Context, masterID string, since time.Time) (int, error)
	List(ctx context.Context, limit int) ([]Message, error)
}
