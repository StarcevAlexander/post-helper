package config

const (
	EnvPort           = "PORT"
	EnvAPIKey         = "ANTHROPIC_API_KEY"
	EnvAccessPassword = "ACCESS_PASSWORD"
	EnvAllowedOrigins = "ALLOWED_ORIGINS"
	EnvModel          = "HELPER_MODEL"
	EnvDatabaseURL    = "DATABASE_URL"
	DefaultPort       = "8080"
	DefaultModel      = "claude-sonnet-5-5"
	MinPasswordLength = 8
	DotEnvFileName    = ".env"
)

var DefaultAllowedOrigins = []string{
	"https://starcevalexander.github.io",
	"http://localhost:4200",
	"http://127.0.0.1:4200",
}
