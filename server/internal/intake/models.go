package intake

import (
	"context"
	"time"
)

type Network struct {
	Platform string `json:"platform"`
	URL      string `json:"url"`
}

type Draft struct {
	Networks   []Network
	References []Network
	Goals      []string
	Note       string
	Review     bool
}

type Request struct {
	ID         string    `json:"id"`
	MasterID   string    `json:"masterId"`
	MasterName string    `json:"masterName,omitempty"`
	Networks   []Network `json:"networks"`
	References []Network `json:"references"`
	Goals      []string  `json:"goals"`
	GoalTitles []string  `json:"goalTitles,omitempty"`
	Note       string    `json:"note,omitempty"`
	Review     bool      `json:"review,omitempty"`
	Status     string    `json:"status"`
	ReplyNote  string    `json:"replyNote,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	ReadyAt    time.Time `json:"readyAt,omitzero"`
}

type Store interface {
	Submit(ctx context.Context, masterID string, draft Draft, now time.Time) (request Request, updated bool, err error)
	Latest(ctx context.Context, masterID string) (Request, error)
	List(ctx context.Context, status string, limit int) ([]Request, error)
	Ready(ctx context.Context, masterID, replyNote string, now time.Time) error
}

type Notifier interface {
	Notify(ctx context.Context, text string) error
}
