package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/media"
	"post-helper/server/internal/notices"
	"post-helper/server/internal/places"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/store"
	"post-helper/server/internal/yandex"
)

type DigestSender interface {
	Send(ctx context.Context) (string, error)
}

type Options struct {
	Digest         DigestSender
	Auditor        audit.Generator
	Refs           refs.Store
	Media          media.Store
	MediaFiles     media.Files
	MediaPlanner   media.Planner
	RefPlanner     refs.Generator
	Places         places.Resolver
	Intake         intake.Store
	Notifier       intake.Notifier
	Feedback       feedback.Store
	PushStore      push.Store
	Pusher         push.Sender
	Notices        notices.Store
	Location       *time.Location
	Yandex         yandex.Exchanger
	YandexClientID string
	Shutdown       func()
	Accounts       accounts.Store
	RetentionDays  int
	AllowedOrigins []string
	Store          store.Store
	Ping           func(ctx context.Context) error
	Logger         *slog.Logger
}

type ClientErrorRequest struct {
	Message string `json:"message"`
	Where   string `json:"where"`
	Stack   string `json:"stack"`
	Version string `json:"version"`
}

type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
	swept  time.Time
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
	TimeZone string `json:"timeZone"`
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

type MediaUploadMeta struct {
	Key     string `json:"key"`
	Unit    string `json:"unit"`
	Format  string `json:"format"`
	Pillar  string `json:"pillar"`
	Idea    string `json:"idea"`
	Overlay string `json:"overlay"`
	Note    string `json:"note"`
}

type NoticeView struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`
	Title   string    `json:"title"`
	Body    string    `json:"body"`
	SentAt  time.Time `json:"sentAt"`
	State   string    `json:"state"`
	Reason  string    `json:"reason,omitempty"`
	Link    string    `json:"link,omitempty"`
	MovedTo string    `json:"movedTo,omitempty"`
}

type MediaStatus struct {
	ID         string        `json:"id"`
	Key        string        `json:"key"`
	Unit       string        `json:"unit"`
	Note       string        `json:"note"`
	Kind       string        `json:"kind"`
	Format     string        `json:"format"`
	Status     string        `json:"status"`
	Error      string        `json:"error"`
	CreatedAt  time.Time     `json:"createdAt"`
	FinishedAt *time.Time    `json:"finishedAt,omitempty"`
	Source     media.Source  `json:"source"`
	Result     *media.Result `json:"result,omitempty"`
	Wish       string        `json:"wish,omitempty"`
	Redos      int           `json:"redos"`
	CanRedo    bool          `json:"canRedo"`
}

type MediaRedoRequest struct {
	Wish string `json:"wish"`
}

type MediaAdminStatus struct {
	MediaStatus
	MasterID string `json:"masterId"`
}

type AgentMediaItem struct {
	ID         string `json:"id"`
	Key        string `json:"key"`
	Unit       string `json:"unit"`
	Kind       string `json:"kind"`
	Format     string `json:"format"`
	SourceType string `json:"sourceType"`
	SourceName string `json:"sourceName"`
	SourceSize int64  `json:"sourceSize"`
	Idea       string `json:"idea"`
	Pillar     string `json:"pillar"`
	Overlay    string `json:"overlay"`
	Note       string `json:"note"`
	Attempts   int    `json:"attempts"`
}

type MediaPlanRequest struct {
	Width      int             `json:"width"`
	Height     int             `json:"height"`
	DurationMs int             `json:"durationMs"`
	Segments   []media.Segment `json:"segments"`
}

type MediaResultRequest struct {
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int    `json:"durationMs"`
	Subtitled  bool   `json:"subtitled"`
	Note       string `json:"note"`
}
