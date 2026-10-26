package media

import (
	"context"
	"io"
	"time"
)

type Source struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

type Result struct {
	Type       string `json:"type"`
	Size       int64  `json:"size"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int    `json:"durationMs"`
	Subtitled  bool   `json:"subtitled"`
	Thumb      bool   `json:"thumb"`
	Note       string `json:"note"`
	Caption    string `json:"caption,omitempty"`
}

type Item struct {
	ID         string
	MasterID   string
	Key        string
	Unit       string
	Kind       string
	Format     string
	Pillar     string
	Idea       string
	Overlay    string
	Note       string
	Caption    string
	Status     string
	Attempts   int
	Error      string
	CreatedAt  time.Time
	ClaimedAt  time.Time
	FinishedAt time.Time
	Source     Source
	SourceRef  string
	Result     Result
	ResultRef  string
	ThumbRef   string
}

type Segment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type Plan struct {
	Preset    string    `json:"preset"`
	Focus     string    `json:"focus"`
	Title     string    `json:"title"`
	Subtitles []Segment `json:"subtitles"`
	Note      string    `json:"note"`
	Caption   string    `json:"caption"`
	Source    string    `json:"source"`
}

type Request struct {
	About      string
	Item       Item
	Width      int
	Height     int
	DurationMs int
	Segments   []Segment
	Preview    []byte
}

type Planner interface {
	Plan(ctx context.Context, request Request) (Plan, error)
}

type Files interface {
	Put(ctx context.Context, ref string, reader io.Reader, limit int64) (int64, error)
	Open(ctx context.Context, ref string) (io.ReadSeekCloser, int64, error)
	Delete(ctx context.Context, refs ...string) error
}

type Store interface {
	Create(ctx context.Context, item Item, limit int) error
	List(ctx context.Context, masterID string) ([]Item, error)
	Get(ctx context.Context, masterID, id string) (Item, error)
	Find(ctx context.Context, id string) (Item, error)
	SetCaption(ctx context.Context, id, caption string) error
	Remove(ctx context.Context, masterID, id string) (Item, error)
	Recent(ctx context.Context, limit int) ([]Item, error)
	Expire(ctx context.Context, now time.Time, lease time.Duration) ([]string, error)
	Claim(ctx context.Context, now time.Time, lease time.Duration) (Item, error)
	Complete(ctx context.Context, id string, result Result, resultRef, thumbRef string, now time.Time) (string, error)
	Fail(ctx context.Context, id, reason string, final bool, now time.Time) (string, error)
	Remaining(ctx context.Context, masterID string) (active, done int, err error)
	MasterOf(ctx context.Context, id string) (string, error)
	Purge(ctx context.Context, before time.Time) ([]string, error)
}
