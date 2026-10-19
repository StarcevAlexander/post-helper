package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("state version conflict")
)

type Master struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	Disabled   bool      `json:"disabled"`
}

type MasterSummary struct {
	Master
	UsageToday int `json:"usageToday"`
	UsageTotal int `json:"usageTotal"`
}

type State struct {
	Version   int             `json:"version"`
	Data      json.RawMessage `json:"data"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type Store interface {
	CreateMaster(ctx context.Context, name, codeHash string) (Master, error)
	FindByCodeHash(ctx context.Context, codeHash string) (Master, error)
	ListMasters(ctx context.Context, since time.Time) ([]MasterSummary, error)
	SetDisabled(ctx context.Context, id string, disabled bool) error
	Touch(ctx context.Context, id string, at time.Time) error
	LoadState(ctx context.Context, id string) (State, error)
	SaveState(ctx context.Context, id string, baseVersion int, data json.RawMessage, at time.Time) (State, error)
	CountUsage(ctx context.Context, id string, since time.Time) (int, error)
	RecordUsage(ctx context.Context, id, kind string, at time.Time) error
}
