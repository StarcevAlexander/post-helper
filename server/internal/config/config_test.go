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

	t.Run("media defaults", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvMediaDir, "")
		t.Setenv(EnvMediaKeepDays, "")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.MediaDir != DefaultMediaDir || cfg.MediaKeepDays != DefaultMediaKeepDays {
			t.Errorf("media = %q, %d", cfg.MediaDir, cfg.MediaKeepDays)
		}
	})

	t.Run("media custom", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvMediaDir, " D:/ph-media ")
		t.Setenv(EnvMediaKeepDays, "7")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.MediaDir != "D:/ph-media" || cfg.MediaKeepDays != 7 {
			t.Errorf("media = %q, %d", cfg.MediaDir, cfg.MediaKeepDays)
		}
	})

	t.Run("media bad keep days", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvMediaKeepDays, "-3")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.MediaKeepDays != DefaultMediaKeepDays {
			t.Errorf("keep days = %d", cfg.MediaKeepDays)
		}
	})

	t.Run("custom origins", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "key")
		t.Setenv(EnvAllowedOrigins, " https://a.example , https://b.example ")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if want := []string{"https://a.example", "https://b.example"}; !slices.Equal(cfg.AllowedOrigins, want) {
			t.Errorf("origins = %v, want %v", cfg.AllowedOrigins, want)
		}
	})

	t.Run("missing key", func(t *testing.T) {
		t.Setenv(EnvAPIKey, "")

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

func TestRetentionAndHistorySettings(t *testing.T) {
	t.Setenv(EnvAPIKey, "key")

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

func TestAdminPort(t *testing.T) {
	t.Setenv(EnvAPIKey, "key")

	t.Run("defaults to a local port", func(t *testing.T) {
		t.Setenv(EnvAdminPort, "")
		cfg, err := Load()
		if err != nil || cfg.AdminPort != DefaultAdminPort {
			t.Fatalf("cfg = %+v, err = %v", cfg, err)
		}
	})
	t.Run("can be moved", func(t *testing.T) {
		t.Setenv(EnvAdminPort, " 9090 ")
		cfg, err := Load()
		if err != nil || cfg.AdminPort != "9090" {
			t.Fatalf("cfg = %+v, err = %v", cfg, err)
		}
	})
}

func TestRequireStore(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"database set", Config{DatabaseURL: "postgres://db"}, false},
		{"no database", Config{}, true},
		{"no database but memory allowed", Config{AllowMemoryStore: true}, false},
		{"database and memory flag", Config{DatabaseURL: "postgres://db", AllowMemoryStore: true}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.cfg.RequireStore(); (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoadReadsAllowMemoryStore(t *testing.T) {
	t.Setenv(EnvAPIKey, "key")
	for value, want := range map[string]bool{"1": true, " 1 ": true, "": false, "0": false, "true": false} {
		t.Setenv(EnvAllowMemoryStore, value)
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.AllowMemoryStore != want {
			t.Errorf("%q: AllowMemoryStore = %v, want %v", value, cfg.AllowMemoryStore, want)
		}
	}
}
