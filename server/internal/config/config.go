package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"post-helper/server/internal/zai"
)

func Load() (Config, error) {
	cfg := Config{
		Port:           valueOr(os.Getenv(EnvPort), DefaultPort),
		APIKey:         strings.TrimSpace(os.Getenv(EnvAPIKey)),
		BaseURL:        valueOr(strings.TrimSpace(os.Getenv(EnvBaseURL)), zai.DefaultBaseURL),
		AllowedOrigins: parseList(os.Getenv(EnvAllowedOrigins), DefaultAllowedOrigins),
		Model:          valueOr(os.Getenv(EnvModel), DefaultModel),
		VisionModel:    valueOr(os.Getenv(EnvVisionModel), DefaultVisionModel),
		DatabaseURL:    strings.TrimSpace(os.Getenv(EnvDatabaseURL)),
		RetentionDays:  nonNegative(os.Getenv(EnvRetentionDays), DefaultRetentionDays),
		HistoryKeep:    positive(os.Getenv(EnvHistoryKeep), DefaultHistoryKeep),
		TelegramToken:  strings.TrimSpace(os.Getenv(EnvTelegramToken)),
		TelegramChatID: strings.TrimSpace(os.Getenv(EnvTelegramChatID)),

		VapidPublicKey:  strings.TrimSpace(os.Getenv(EnvVapidPublicKey)),
		VapidPrivateKey: strings.TrimSpace(os.Getenv(EnvVapidPrivateKey)),
		VapidSubject:    valueOr(strings.TrimSpace(os.Getenv(EnvVapidSubject)), DefaultVapidSubject),

		YandexClientID:     strings.TrimSpace(os.Getenv(EnvYandexClientID)),
		YandexClientSecret: strings.TrimSpace(os.Getenv(EnvYandexSecret)),

		AdminPort:        valueOr(strings.TrimSpace(os.Getenv(EnvAdminPort)), DefaultAdminPort),
		ReminderTimezone: strings.TrimSpace(os.Getenv(EnvReminderTimezone)),
		AllowMemoryStore: strings.TrimSpace(os.Getenv(EnvAllowMemoryStore)) == AllowMemoryStoreOn,

		MediaDir:      valueOr(strings.TrimSpace(os.Getenv(EnvMediaDir)), DefaultMediaDir),
		MediaKeepDays: positive(os.Getenv(EnvMediaKeepDays), DefaultMediaKeepDays),
	}

	var problems []error
	if cfg.APIKey == "" {
		problems = append(problems, fmt.Errorf("%s is not set", EnvAPIKey))
	}
	if err := errors.Join(problems...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) RequireStore() error {
	if c.DatabaseURL == "" && !c.AllowMemoryStore {
		return fmt.Errorf("%s is not set: master data would be lost on restart (set %s=%s to run in memory on purpose)",
			EnvDatabaseURL, EnvAllowMemoryStore, AllowMemoryStoreOn)
	}
	return nil
}

func LoadDotEnv(path string) error {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		key, value, ok := parseDotEnvLine(scanner.Text())
		if !ok {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("set %s: %w", key, err)
		}
	}
	return scanner.Err()
}

func parseDotEnvLine(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(key), "export "))
	value = strings.Trim(strings.TrimSpace(value), `"'`)
	return key, value, key != ""
}

func parseList(raw string, fallback []string) []string {
	var items []string
	for part := range strings.SplitSeq(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	if len(items) == 0 {
		return fallback
	}
	return items
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nonNegative(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

func positive(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
