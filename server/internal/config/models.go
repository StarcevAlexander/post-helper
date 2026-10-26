package config

type Config struct {
	Port            string
	APIKey          string
	AllowedOrigins  []string
	Model           string
	DatabaseURL     string
	RetentionDays   int
	HistoryKeep     int
	TelegramToken   string
	TelegramChatID  string
	VapidPublicKey  string
	VapidPrivateKey string
	VapidSubject    string

	YandexClientID     string
	YandexClientSecret string

	AdminPort        string
	ReminderTimezone string
	AllowMemoryStore bool

	MediaDir      string
	MediaKeepDays int
}
