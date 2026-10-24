package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/places"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/store"
	"post-helper/server/internal/yandex"
)

type Options struct {
	Auditor        audit.Generator
	Refs           refs.Store
	RefPlanner     refs.Generator
	Places         places.Resolver
	Intake         intake.Store
	Notifier       intake.Notifier
	PushStore      push.Store
	Pusher         push.Sender
	Yandex         yandex.Exchanger
	YandexClientID string
	Shutdown       func()
	Accounts       accounts.Store
	RetentionDays  int
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

type ErrorResponse struct {
	Error string `json:"error"`
}

type MeResponse struct {
	Name          string   `json:"name"`
	RetentionDays int      `json:"retentionDays"`
	Providers     []string `json:"providers"`
}

type AuthConfigResponse struct {
	YandexClientID string `json:"yandexClientId"`
}

type YandexCodeRequest struct {
	Code        string `json:"code"`
	RedirectURI string `json:"redirectUri"`
}

type SessionResponse struct {
	Token string `json:"token"`
	Name  string `json:"name"`
}

type ProvidersResponse struct {
	Providers []string `json:"providers"`
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

type RenameRequest struct {
	Name string `json:"name"`
}

type DisabledRequest struct {
	Disabled bool `json:"disabled"`
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

type PushKeyResponse struct {
	PublicKey string `json:"publicKey"`
}

type PushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

type PushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

type AdminPushRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

type AdminPushResponse struct {
	Sent int `json:"sent"`
}
