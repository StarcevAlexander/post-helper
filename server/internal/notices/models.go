package notices

import (
	"context"
	"errors"
	"time"

	"post-helper/server/internal/plan"
	"post-helper/server/internal/push"
)

var ErrNotFound = errors.New("notice not found")

type Entry struct {
	ID        string
	MasterID  string
	Title     string
	Body      string
	URL       string
	Topic     push.Topic
	Delivered int
	SentAt    time.Time
}

type Verdict struct {
	State   string
	Reason  string
	Link    string
	MovedTo string
}

type Facts struct {
	Plan      plan.Calendar
	HasPlan   bool
	MediaDone map[string]bool
	RefsReady bool
	Today     string
}

type Store interface {
	Add(ctx context.Context, entry Entry) error
	List(ctx context.Context, masterID string, limit int) ([]Entry, error)
	Get(ctx context.Context, masterID, id string) (Entry, error)
	Purge(ctx context.Context, before time.Time) (int64, error)
}
