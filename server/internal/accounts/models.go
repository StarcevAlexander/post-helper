package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrConflict      = errors.New("state version conflict")
	ErrIdentityTaken = errors.New("identity is linked to another master")
)

const (
	MaxTokensPerMaster = 20
	ProviderYandex     = "yandex"
)

type Master struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	Disabled   bool      `json:"disabled"`
	City       string    `json:"city"`
	Timezone   string    `json:"timezone"`
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

type Event struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

type StateVersion struct {
	Version int       `json:"version"`
	SavedAt time.Time `json:"savedAt"`
	Size    int       `json:"size"`
}

type StateSnapshot struct {
	Version int             `json:"version"`
	SavedAt time.Time       `json:"savedAt"`
	Data    json.RawMessage `json:"data"`
}

type Export struct {
	ExportedAt time.Time       `json:"exportedAt"`
	Master     Master          `json:"master"`
	State      *State          `json:"state"`
	History    []StateSnapshot `json:"history"`
	Events     []Event         `json:"events"`
}

const DefaultHistoryKeep = 200

const (
	JobQueued   = "queued"
	JobRunning  = "running"
	JobDone     = "done"
	JobFailed   = "failed"
	JobCanceled = "canceled"

	MaxJobAttempts = 3
)

var (
	ErrJobActive = errors.New("an audit job is already active")
	ErrJobState  = errors.New("audit job is not in the right state")
)

type AuditJob struct {
	ID         string          `json:"id"`
	MasterID   string          `json:"masterId"`
	MasterName string          `json:"masterName,omitempty"`
	Handle     string          `json:"handle"`
	Status     string          `json:"status"`
	Attempts   int             `json:"attempts"`
	CreatedAt  time.Time       `json:"createdAt"`
	ClaimedAt  time.Time       `json:"claimedAt"`
	FinishedAt time.Time       `json:"finishedAt"`
	Error      string          `json:"error,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
}

type Store interface {
	CreateMaster(ctx context.Context, name, codeHash string) (Master, error)
	FindByCodeHash(ctx context.Context, codeHash string) (Master, error)
	ListMasters(ctx context.Context, since time.Time) ([]MasterSummary, error)
	SetDisabled(ctx context.Context, id string, disabled bool) error
	GetMaster(ctx context.Context, id string) (Master, error)
	SetLocation(ctx context.Context, id, city, timezone string) error
	RenameMaster(ctx context.Context, id, name string) error
	FindByIdentity(ctx context.Context, provider, subject string) (Master, error)
	RegisterIdentity(ctx context.Context, name, codeHash, provider, subject, email string) (Master, error)
	LinkIdentity(ctx context.Context, masterID, provider, subject, email string) error
	Providers(ctx context.Context, masterID string) ([]string, error)
	Email(ctx context.Context, masterID string) (string, error)
	AddToken(ctx context.Context, masterID, tokenHash string) error
	Touch(ctx context.Context, id string, at time.Time) error
	LoadState(ctx context.Context, id string) (State, error)
	SaveState(ctx context.Context, id string, baseVersion int, data json.RawMessage, at time.Time) (State, error)
	RecordUsage(ctx context.Context, id, kind string, at time.Time) error
	RecordEvent(ctx context.Context, id, kind string, payload json.RawMessage, at time.Time) error
	ListEvents(ctx context.Context, id string, limit int) ([]Event, error)
	StateVersions(ctx context.Context, id string, limit int) ([]StateVersion, error)
	StateSnapshot(ctx context.Context, id string, version int) (StateSnapshot, error)
	ExportMaster(ctx context.Context, id string) (Export, error)
	DeleteMaster(ctx context.Context, id string) error
	Purge(ctx context.Context, before time.Time) (int64, error)
	CreateAuditJob(ctx context.Context, masterID, handle string, at time.Time) (AuditJob, error)
	LatestAuditJob(ctx context.Context, masterID string) (AuditJob, error)
	AuditJob(ctx context.Context, id string) (AuditJob, error)
	ClaimAuditJob(ctx context.Context, now time.Time, lease time.Duration) (AuditJob, error)
	CompleteAuditJob(ctx context.Context, id string, result json.RawMessage, at time.Time) error
	FailAuditJob(ctx context.Context, id, reason string, final bool, at time.Time) error
	CancelAuditJob(ctx context.Context, masterID, id string, at time.Time) error
	ListAuditJobs(ctx context.Context, limit int) ([]AuditJob, error)
}
