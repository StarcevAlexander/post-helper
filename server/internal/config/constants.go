package config

const (
	EnvPort              = "PORT"
	EnvAPIKey            = "ANTHROPIC_API_KEY"
	EnvAllowedOrigins    = "ALLOWED_ORIGINS"
	EnvModel             = "HELPER_MODEL"
	EnvDatabaseURL       = "DATABASE_URL"
	EnvRetentionDays     = "RETENTION_DAYS"
	EnvTelegramToken     = "TELEGRAM_BOT_TOKEN"
	EnvTelegramChatID    = "TELEGRAM_CHAT_ID"
	EnvHistoryKeep       = "STATE_HISTORY_KEEP"
	EnvVapidPublicKey    = "VAPID_PUBLIC_KEY"
	EnvVapidPrivateKey   = "VAPID_PRIVATE_KEY"
	EnvVapidSubject      = "VAPID_SUBJECT"
	EnvYandexClientID    = "YANDEX_CLIENT_ID"
	EnvYandexSecret      = "YANDEX_CLIENT_SECRET"
	EnvAdminPort         = "ADMIN_PORT"
	DefaultAdminPort     = "8081"
	EnvReminderTimezone  = "REMINDER_TIMEZONE"
	EnvAllowMemoryStore  = "ALLOW_MEMORY_STORE"
	AllowMemoryStoreOn   = "1"
	DefaultVapidSubject  = "https://starcevalexander.github.io/post-helper/"
	DefaultRetentionDays = 1095
	DefaultHistoryKeep   = 200
	DefaultPort          = "8080"
	DefaultModel         = "claude-sonnet-5-5"
	DotEnvFileName       = ".env"
	EnvMediaDir          = "MEDIA_DIR"
	EnvMediaKeepDays     = "MEDIA_KEEP_DAYS"
	DefaultMediaDir      = "media"
	DefaultMediaKeepDays = 30
)

var DefaultAllowedOrigins = []string{
	"https://starcevalexander.github.io",
	"http://localhost:4200",
	"http://127.0.0.1:4200",
}
