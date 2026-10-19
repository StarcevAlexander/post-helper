package config

type Config struct {
	Port           string
	APIKey         string
	AccessPassword string
	AllowedOrigins []string
	Model          string
	DatabaseURL    string
}
