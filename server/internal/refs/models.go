package refs

import (
	"context"
	"time"

	"post-helper/server/internal/strategy"
)

type OrderItem struct {
	Key    string `json:"key"`
	Format string `json:"format"`
	Pillar string `json:"pillar"`
	Idea   string `json:"idea"`
	Date   string `json:"date"`
}

type Item struct {
	ID         string
	MasterID   string
	Key        string
	Format     string
	Pillar     string
	Idea       string
	Date       string
	Status     string
	Attempts   int
	CreatedAt  time.Time
	ClaimedAt  time.Time
	FinishedAt time.Time
	Error      string
}

type File struct {
	ID        string
	Index     int
	Kind      string
	MediaType string
	Caption   string
	Data      []byte
}

type FileMeta struct {
	ID        string `json:"id"`
	Index     int    `json:"index"`
	Kind      string `json:"kind"`
	MediaType string `json:"mediaType"`
	Caption   string `json:"caption"`
	Size      int    `json:"size"`
}

type Status struct {
	Key    string     `json:"key"`
	Status string     `json:"status"`
	Kind   string     `json:"kind"`
	Date   string     `json:"date,omitempty"`
	Stale  bool       `json:"stale"`
	Error  string     `json:"error,omitempty"`
	Files  []FileMeta `json:"files"`
}

type Prompt struct {
	Prompt  string `json:"prompt"`
	Caption string `json:"caption"`
}

type Plan struct {
	Prompts []Prompt `json:"prompts"`
}

type Request struct {
	Profile strategy.Profile
	Item    Item
}

type Generator interface {
	Generate(ctx context.Context, request Request) (Plan, error)
}

type Store interface {
	Sync(ctx context.Context, masterID string, items []OrderItem, now time.Time) (added, removed int, err error)
	Statuses(ctx context.Context, masterID string, now time.Time) ([]Status, error)
	Confirm(ctx context.Context, masterID, key string) error
	Deliver(ctx context.Context, masterID string, item OrderItem, files []File, now time.Time) error
	File(ctx context.Context, masterID, fileID string) (File, error)
	Claim(ctx context.Context, now time.Time, lease time.Duration) (Item, error)
	Complete(ctx context.Context, id string, files []File, now time.Time) error
	Fail(ctx context.Context, id, reason string, final bool, now time.Time) error
	DeleteMaster(ctx context.Context, masterID string) error
}
