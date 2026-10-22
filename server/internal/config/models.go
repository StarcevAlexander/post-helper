package config

type Config struct {
	Port           string
	APIKey         string
	AccessPassword string
	AllowedOrigins []string
	Model          string
	DatabaseURL    string
	DailyAILimit   int
	RetentionDays  int
	HistoryKeep    int
	AgentToken     string
	TelegramToken  string
	TelegramChatID string
}
