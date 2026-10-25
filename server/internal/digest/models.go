package digest

import (
	"context"
	"time"
)

type Sent interface {
	Has(ctx context.Context, key string) (bool, error)
	Mark(ctx context.Context, key string, at time.Time) error
}

type calendar struct {
	Items []struct {
		Date string `json:"date"`
		Done bool   `json:"done"`
	} `json:"items"`
}

type MasterRow struct {
	Name         string
	City         string
	HasPlan      bool
	PlannedSoFar int
	DoneSoFar    int
	Overdue      int
	ThisWeek     int
	EndsOn       string
	DaysLeft     int
	Pushes       bool
	LastSeenDays int
	NeverSeen    bool
	Waiting      string
	WaitingSince string
}

type Report struct {
	Date     string
	Masters  []MasterRow
	WithPlan int
}

type WaitingRow struct {
	MasterID string
	Name     string
	City     string
	Review   bool
	Since    time.Time
	Age      time.Duration
}
