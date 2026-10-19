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
