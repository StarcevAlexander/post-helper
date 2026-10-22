package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/chat"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/kit"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/review"
	"post-helper/server/internal/store"
	"post-helper/server/internal/strategy"
)

type Options struct {
	Responder      chat.Responder
	Strategist     strategy.Generator
	KitMaker       kit.Generator
	Auditor        audit.Generator
	Reviewer       review.Generator
	Refs           refs.Store
	RefPlanner     refs.Generator
	Intake         intake.Store
	Notifier       intake.Notifier
	AgentToken     string
	Accounts       accounts.Store
	DailyAILimit   int
	RetentionDays  int
	Password       string
	AllowedOrigins []string
	Store          store.Store
	Logger         *slog.Logger
}

type IngestRequest struct {
	Source         string          `json:"source"`
	ConversationID string          `json:"conversationId"`
	Messages       []IngestMessage `json:"messages"`
}

type IngestMessage struct {
	ExternalID string    `json:"externalId"`
	Role       string    `json:"role"`
	Text       string    `json:"text"`
	At         time.Time `json:"at"`
}

type IngestResponse struct {
	Accepted int `json:"accepted"`
}

type ClientErrorRequest struct {
	Message string `json:"message"`
	Where   string `json:"where"`
	Stack   string `json:"stack"`
	Version string `json:"version"`
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

type ReplyResponse struct {
	Reply string `json:"reply"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type KitRequest struct {
	Profile     strategy.Profile `json:"profile"`
	Positioning string           `json:"positioning"`
	Format      string           `json:"format"`
	Pillar      string           `json:"pillar"`
	Idea        string           `json:"idea"`
}

type MeResponse struct {
	Role          string `json:"role"`
	Name          string `json:"name"`
	DailyLimit    int    `json:"dailyLimit"`
	UsageToday    int    `json:"usageToday"`
	RetentionDays int    `json:"retentionDays"`
}

type StateRequest struct {
	BaseVersion int             `json:"baseVersion"`
	Data        json.RawMessage `json:"data"`
}

type StateConflictResponse struct {
	Error string         `json:"error"`
	State accounts.State `json:"state"`
}

type CreateMasterRequest struct {
	Name string `json:"name"`
}

type CreateMasterResponse struct {
	Master accounts.Master `json:"master"`
	Code   string          `json:"code"`
}

type DisabledRequest struct {
	Disabled bool `json:"disabled"`
}

type ReviewRequest struct {
	Profile     strategy.Profile `json:"profile"`
	Positioning string           `json:"positioning"`
	Cadence     strategy.Cadence `json:"cadence"`
	Pillars     []review.Pillar  `json:"pillars"`
	Items       []review.Item    `json:"items"`
	Results     review.Results   `json:"results"`
}

type RestoreRequest struct {
	Version int `json:"version"`
}

type AuditJobRequest struct {
	Handle  string `json:"handle"`
	Consent bool   `json:"consent"`
}

type AuditJobConflict struct {
	Error string            `json:"error"`
	Job   accounts.AuditJob `json:"job"`
}

type AgentJob struct {
	ID       string     `json:"id"`
	Handle   string     `json:"handle"`
	Attempts int        `json:"attempts"`
	Profile  JobProfile `json:"profile"`
}

type AgentFailRequest struct {
	Reason string `json:"reason"`
	Final  bool   `json:"final"`
}

type RefsOrderRequest struct {
	Items []refs.OrderItem `json:"items"`
}

type RefAgentItem struct {
	ID      string        `json:"id"`
	Key     string        `json:"key"`
	Format  string        `json:"format"`
	Kind    string        `json:"kind"`
	Prompts []refs.Prompt `json:"prompts"`
}

type RefsMadeRequest struct {
	Key string `json:"key"`
}
