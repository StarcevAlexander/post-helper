package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
)

func Load() (Config, error) {
	cfg := Config{
		Port:           valueOr(os.Getenv(EnvPort), DefaultPort),
		APIKey:         strings.TrimSpace(os.Getenv(EnvAPIKey)),
		AccessPassword: os.Getenv(EnvAccessPassword),
		AllowedOrigins: parseList(os.Getenv(EnvAllowedOrigins), DefaultAllowedOrigins),
		Model:          valueOr(os.Getenv(EnvModel), DefaultModel),
		DatabaseURL:    strings.TrimSpace(os.Getenv(EnvDatabaseURL)),
	}

	var problems []error
	if cfg.APIKey == "" {
		problems = append(problems, fmt.Errorf("%s is not set", EnvAPIKey))
	}
	if len(cfg.AccessPassword) < MinPasswordLength {
		problems = append(problems, fmt.Errorf("%s must be at least %d characters", EnvAccessPassword, MinPasswordLength))
	}
	if err := errors.Join(problems...); err != nil {
		return Config{}, err
	}
	return cfg, nil
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
