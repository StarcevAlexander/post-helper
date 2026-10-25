package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/refs"
)

func TestRateLimiter(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	limiter := newRateLimiter(2, time.Minute)

	steps := []struct {
		key  string
		at   time.Duration
		want bool
	}{
		{"a", 0, true},
		{"a", time.Second, true},
		{"a", 2 * time.Second, false},
		{"b", 2 * time.Second, true},
		{"a", time.Minute + time.Second, true},
		{"a", time.Minute + time.Second, false},
		{"a", 3 * time.Minute, true},
	}
	for _, step := range steps {
		if got := limiter.allow(step.key, start.Add(step.at)); got != step.want {
			t.Fatalf("allow(%s, +%s) = %v, want %v", step.key, step.at, got, step.want)
		}
	}
}

func TestRateLimiterForgetsIdleKeys(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	limiter := newRateLimiter(1, time.Minute)
	for _, key := range []string{"a", "b", "c"} {
		limiter.allow(key, start)
	}

	limiter.allow("d", start.Add(2*time.Minute))

	if len(limiter.hits) != 1 {
		t.Errorf("keys after the sweep = %d, want only the fresh one", len(limiter.hits))
	}
}

func TestRateLimiterStaysBounded(t *testing.T) {
	limiter := newRateLimiter(1, time.Hour)
	now := time.Now()
	for index := range MaxLimiterKeys + 50 {
		limiter.allow(string(rune('a'+index%26))+strings.Repeat("x", index), now)
	}

	if len(limiter.hits) > MaxLimiterKeys {
		t.Errorf("keys = %d, want at most %d", len(limiter.hits), MaxLimiterKeys)
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name      string
		forwarded string
		remote    string
		want      string
	}{
		{"remote address", "", "203.0.113.7:5555", "203.0.113.7"},
		{"remote v6", "", "[2001:db8::1]:5555", "2001:db8::1"},
		{"remote without port", "", "203.0.113.7", "203.0.113.7"},
		{"first forwarded", "198.51.100.1, 10.0.0.2", "203.0.113.7:5555", "198.51.100.1"},
		{"single forwarded", " 198.51.100.1 ", "203.0.113.7:5555", "198.51.100.1"},
		{"empty forwarded", " , 10.0.0.2", "203.0.113.7:5555", "203.0.113.7"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/x", nil)
			request.RemoteAddr = tt.remote
			if tt.forwarded != "" {
				request.Header.Set(HeaderForwardedFor, tt.forwarded)
			}
			if got := clientIP(request); got != tt.want {
				t.Errorf("clientIP = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestYandexSignInLimitIsPerClientAddress(t *testing.T) {
	fixture := newYandexFixture(t)
	body := `{"code":"abc","redirectUri":"` + yandexOrigin + `/"}`
	callFrom := func(address string) int {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/yandex", strings.NewReader(body))
		request.Header.Set(HeaderForwardedFor, address)
		recorder := httptest.NewRecorder()
		fixture.handler.ServeHTTP(recorder, request)
		return recorder.Code
	}

	var last int
	for range SignInLimitPerWindow + 1 {
		last = callFrom("198.51.100.1")
	}

	if last != http.StatusTooManyRequests {
		t.Errorf("noisy address: last status = %d", last)
	}
	if got := callFrom("198.51.100.2"); got != http.StatusOK {
		t.Errorf("another address must not be limited, got %d", got)
	}
}

type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(data)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func TestSafeGoRecoversAndLogs(t *testing.T) {
	output := &syncBuffer{}
	logger := slog.New(slog.NewTextHandler(output, nil))
	ran := make(chan struct{})

	safeGo(logger, "explode", func() {
		defer close(ran)
		panic("kaboom")
	})
	<-ran

	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(output.String(), "kaboom") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if text := output.String(); !strings.Contains(text, "kaboom") || !strings.Contains(text, "explode") {
		t.Fatalf("panic was not logged: %q", text)
	}
}

func TestHealthCheckPingsTheDatabase(t *testing.T) {
	tests := []struct {
		name string
		ping func(context.Context) error
		want int
	}{
		{"no database", nil, http.StatusNoContent},
		{"database alive", func(context.Context) error { return nil }, http.StatusNoContent},
		{"database down", func(context.Context) error { return errors.New("connection refused") }, http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			options := Options{Ping: tt.ping, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
			for name, handler := range map[string]http.Handler{"public": NewHandler(options), "admin": NewAdminHandler(options)} {
				request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
				request.Host = "127.0.0.1:8081"
				recorder := httptest.NewRecorder()
				handler.ServeHTTP(recorder, request)
				if recorder.Code != tt.want {
					t.Errorf("%s: status = %d, want %d", name, recorder.Code, tt.want)
				}
			}
		})
	}
}

const locationOnlyJSON = `{"location":{"city":"Казань","timezone":"Europe/Moscow"}}`

func TestDeliveryWithoutAPlanDoesNotMarkTheRequestReady(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus string
	}{
		{"location only", locationOnlyJSON, `"status":"new"`},
		{"recommendations only", `{"recommendations":[]}`, `"status":"new"`},
		{"with a plan", planJSON, `"status":"ready"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newIntakeFixture(t)
			code, master := fixture.master(t, "Анна")
			fixture.call(http.MethodPost, "/api/intake", code, intakeBody)
			fixture.notifier.wait(t)

			delivered := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, tt.body)
			latest := fixture.call(http.MethodGet, "/api/intake", code, "")

			if delivered.Code != http.StatusOK {
				t.Fatalf("deliver = %d %s", delivered.Code, delivered.Body)
			}
			if !strings.Contains(latest.Body.String(), tt.wantStatus) {
				t.Errorf("latest = %s, want %s", latest.Body, tt.wantStatus)
			}
		})
	}
}

func TestLaterDeliveryKeepsTheReplyNote(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/intake", code, intakeBody)
	fixture.notifier.wait(t)
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, locationOnlyJSON)
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, `{"calendar":null,"strategy":{"summary":"s","positioning":"p"}}`)
	latest := fixture.call(http.MethodGet, "/api/intake", code, "")

	if !strings.Contains(latest.Body.String(), "План на месяц готов") || !strings.Contains(latest.Body.String(), `"status":"ready"`) {
		t.Errorf("latest = %s", latest.Body)
	}
}

type failingRefs struct {
	*refs.Memory
}

func (failingRefs) Sync(context.Context, string, []refs.OrderItem, time.Time) (int, int, error) {
	return 0, 0, errors.New("database down")
}

func TestDeliverPlanReportsAFailedReferencesOrder(t *testing.T) {
	base := newAccountFixture(t, 50)
	base.handler = bothHandlers(Options{
		Accounts:       base.store,
		Refs:           failingRefs{Memory: refs.NewMemory()},
		RefPlanner:     &fakePlanner{},
		Intake:         intake.NewMemory(),
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	_, master := base.master(t, "Анна")

	delivered := base.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)
	state, err := base.store.LoadState(context.Background(), master.ID)

	if delivered.Code != http.StatusInternalServerError || !strings.Contains(delivered.Body.String(), "референс") {
		t.Fatalf("deliver = %d %s", delivered.Code, delivered.Body)
	}
	if err != nil || state.Version != 1 {
		t.Errorf("the saved plan must stay: version = %d, err = %v", state.Version, err)
	}
}

func TestDeliverRefsCannotOverwriteAConfirmedItem(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)
	fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes})
	confirmed := fixture.call(http.MethodPost, "/api/refs/made", code, `{"key":"w1-a"}`)

	again := fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes})

	if confirmed.Code != http.StatusOK || again.Code != http.StatusConflict {
		t.Errorf("confirmed = %d, again = %d %s", confirmed.Code, again.Code, again.Body)
	}
}

type conflictingState struct {
	*accounts.Memory
	conflict bool
}

func (c *conflictingState) SaveState(ctx context.Context, id string, base int, data json.RawMessage, at time.Time) (accounts.State, error) {
	if c.conflict {
		return accounts.State{}, accounts.ErrConflict
	}
	return c.Memory.SaveState(ctx, id, base, data, at)
}

func TestAdminRestoreAnswersConflictWhenTheStateMovedOn(t *testing.T) {
	store := &conflictingState{Memory: accounts.NewMemory()}
	master, _ := store.CreateMaster(context.Background(), "Анна", "hash")
	_, _ = store.SaveState(context.Background(), master.ID, 0, []byte(`{"a":1}`), time.Now())
	handler := bothHandlers(Options{Accounts: store, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	restore := func() int {
		request := httptest.NewRequest(http.MethodPost, "/api/admin/masters/"+master.ID+"/restore", strings.NewReader(`{"version":1}`))
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Code
	}

	if got := restore(); got != http.StatusOK {
		t.Fatalf("restore without a race = %d", got)
	}
	store.conflict = true
	if got := restore(); got != http.StatusConflict {
		t.Errorf("restore with a conflict = %d, want %d", got, http.StatusConflict)
	}
}

func TestPushSubscribeLearnsTheTimeZoneOnlyWhenUnknown(t *testing.T) {
	tests := []struct {
		name     string
		existing string
		sent     string
		want     string
	}{
		{"unknown zone is filled", "", "Asia/Irkutsk", "Asia/Irkutsk"},
		{"owner zone is kept", "Europe/Moscow", "Asia/Irkutsk", "Europe/Moscow"},
		{"invalid zone is ignored", "", "Mars/Base", ""},
		{"no zone sent", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newPushFixture(t, newFakePusher(1))
			code, master := fixture.master(t, "Анна")
			if tt.existing != "" {
				if err := fixture.accounts.SetLocation(context.Background(), master.ID, "Москва", tt.existing); err != nil {
					t.Fatal(err)
				}
			}
			body := `{"endpoint":"https://push.example/abc","timeZone":"` + tt.sent + `","keys":{"p256dh":"BKey","auth":"secret"}}`

			response := fixture.call(http.MethodPost, "/api/push/subscribe", code, body)
			stored, _ := fixture.accounts.GetMaster(context.Background(), master.ID)

			if response.Code != http.StatusNoContent || stored.Timezone != tt.want {
				t.Errorf("status = %d, timezone = %q, want %q", response.Code, stored.Timezone, tt.want)
			}
		})
	}
}
