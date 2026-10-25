package intake

import (
	"context"
	"time"
)

type Network struct {
	Platform string `json:"platform"`
	URL      string `json:"url"`
}

type Stats struct {
	Followers *int   `json:"followers,omitempty"`
	Reach     *int   `json:"reach,omitempty"`
	BestPost  string `json:"bestPost,omitempty"`
}

type Schedule struct {
	ShootDays   []int  `json:"shootDays"`
	ShootTime   string `json:"shootTime,omitempty"`
	PublishTime string `json:"publishTime,omitempty"`
}

type Draft struct {
	Networks   []Network
	References []Network
	Goals      []string
	Note       string
	City       string
	Review     bool
	Stats      *Stats
	Schedule   *Schedule
}

type Request struct {
	ID             string    `json:"id"`
	MasterID       string    `json:"masterId"`
	MasterName     string    `json:"masterName,omitempty"`
	Networks       []Network `json:"networks"`
	References     []Network `json:"references"`
	Goals          []string  `json:"goals"`
	GoalTitles     []string  `json:"goalTitles,omitempty"`
	Note           string    `json:"note,omitempty"`
	Review         bool      `json:"review,omitempty"`
	Stats          *Stats    `json:"stats,omitempty"`
	Schedule       *Schedule `json:"schedule,omitempty"`
	City           string    `json:"city,omitempty"`
	MasterTimezone string    `json:"masterTimezone,omitempty"`
	Status         string    `json:"status"`
	ReplyNote      string    `json:"replyNote,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ReadyAt        time.Time `json:"readyAt,omitzero"`
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
