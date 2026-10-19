package config

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvAccessPassword, "long-enough-pass")
		t.Setenv(EnvPort, "")
		t.Setenv(EnvAllowedOrigins, "")
		t.Setenv(EnvModel, "")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.Port != DefaultPort || cfg.Model != DefaultModel {
			t.Errorf("cfg = %+v", cfg)
		}
		if !slices.Equal(cfg.AllowedOrigins, DefaultAllowedOrigins) {
			t.Errorf("origins = %v", cfg.AllowedOrigins)
		}
	})

	t.Run("custom origins", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvAccessPassword, "long-enough-pass")
		t.Setenv(EnvAllowedOrigins, " https://a.example , https://b.example ")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if want := []string{"https://a.example", "https://b.example"}; !slices.Equal(cfg.AllowedOrigins, want) {
			t.Errorf("origins = %v, want %v", cfg.AllowedOrigins, want)
		}
	})

	t.Run("missing secrets", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "")
		t.Setenv(EnvAccessPassword, "short")

		if _, err := Load(); err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestLoadDotEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\nDOTENV_NEW=from-file\nDOTENV_KEEP=from-file\nexport DOTENV_QUOTED=\"quoted value\"\n\nbroken line\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DOTENV_KEEP", "from-env")
	t.Setenv("DOTENV_NEW", "")
	if err := os.Unsetenv("DOTENV_NEW"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Unsetenv("DOTENV_NEW")
		_ = os.Unsetenv("DOTENV_QUOTED")
	})

	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("LoadDotEnv: %v", err)
	}
	if got := os.Getenv("DOTENV_NEW"); got != "from-file" {
		t.Errorf("DOTENV_NEW = %q", got)
	}
	if got := os.Getenv("DOTENV_KEEP"); got != "from-env" {
		t.Errorf("DOTENV_KEEP = %q, environment must win", got)
	}
	if got := os.Getenv("DOTENV_QUOTED"); got != "quoted value" {
		t.Errorf("DOTENV_QUOTED = %q", got)
	}
}

func TestLoadDotEnvMissingFile(t *testing.T) {
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "absent.env")); err != nil {
		t.Errorf("missing file must not be an error: %v", err)
	}
}

func TestDailyAILimit(t *testing.T) {
	tests := []struct {
		raw  string
		want int
	}{
		{raw: "", want: DefaultDailyLimit},
		{raw: "abc", want: DefaultDailyLimit},
		{raw: "-5", want: DefaultDailyLimit},
		{raw: "25", want: 25},
		{raw: " 40 ", want: 40},
		{raw: "0", want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			t.Setenv(EnvAPIKey, "key")
			t.Setenv(EnvAccessPassword, "long-enough-pass")
			t.Setenv(EnvDailyAILimit, tt.raw)

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.DailyAILimit != tt.want {
				t.Errorf("limit = %d, want %d", cfg.DailyAILimit, tt.want)
			}
		})
	}
}

func TestRetentionAndHistorySettings(t *testing.T) {
	t.Setenv(EnvAPIKey, "key")
	t.Setenv(EnvAccessPassword, "long-enough-pass")

	t.Run("defaults keep data for three years and 200 versions", func(t *testing.T) {
		t.Setenv(EnvRetentionDays, "")
		t.Setenv(EnvHistoryKeep, "")
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.RetentionDays != 1095 || cfg.HistoryKeep != 200 {
			t.Errorf("cfg = %+v", cfg)
		}
	})
	t.Run("zero retention means forever", func(t *testing.T) {
		t.Setenv(EnvRetentionDays, "0")
		cfg, _ := Load()
		if cfg.RetentionDays != 0 {
			t.Errorf("retention = %d", cfg.RetentionDays)
		}
	})
	t.Run("custom values", func(t *testing.T) {
		t.Setenv(EnvRetentionDays, " 365 ")
		t.Setenv(EnvHistoryKeep, "50")
		cfg, _ := Load()
		if cfg.RetentionDays != 365 || cfg.HistoryKeep != 50 {
			t.Errorf("cfg = %+v", cfg)
		}
	})
	t.Run("garbage falls back", func(t *testing.T) {
		t.Setenv(EnvRetentionDays, "-3")
		t.Setenv(EnvHistoryKeep, "0")
		cfg, _ := Load()
		if cfg.RetentionDays != DefaultRetentionDays || cfg.HistoryKeep != DefaultHistoryKeep {
			t.Errorf("cfg = %+v", cfg)
		}
	})
}

func TestAgentToken(t *testing.T) {
	t.Setenv(EnvAPIKey, "key")
	t.Setenv(EnvAccessPassword, "long-enough-pass")

	t.Run("not set means the agent is off", func(t *testing.T) {
		t.Setenv(EnvAgentToken, "")
		cfg, err := Load()
		if err != nil || cfg.AgentToken != "" {
			t.Fatalf("cfg = %+v, err = %v", cfg, err)
		}
	})
	t.Run("a long token is accepted and trimmed", func(t *testing.T) {
		t.Setenv(EnvAgentToken, "  0123456789abcdef0123456789abcdef  ")
		cfg, err := Load()
		if err != nil || cfg.AgentToken != "0123456789abcdef0123456789abcdef" {
			t.Fatalf("cfg = %+v, err = %v", cfg, err)
		}
	})
	t.Run("a short token is refused", func(t *testing.T) {
		t.Setenv(EnvAgentToken, "short")
		if _, err := Load(); err == nil {
			t.Fatal("a weak agent token must stop the server from starting")
		}
	})
}
