package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func browserKeys(t *testing.T) (string, string) {
	t.Helper()
	private, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(private.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(secret)
}

func TestCleanSubscription(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		p256dh   string
		auth     string
		ok       bool
	}{
		{"valid", "https://push.example/abc", "key", "secret", true},
		{"plain http", "http://push.example/abc", "key", "secret", false},
		{"no host", "https:///abc", "key", "secret", false},
		{"empty endpoint", "", "key", "secret", false},
		{"no p256dh", "https://push.example/abc", "", "secret", false},
		{"no auth", "https://push.example/abc", "key", " ", false},
		{"huge endpoint", "https://push.example/" + strings.Repeat("a", MaxEndpointLength), "key", "secret", false},
		{"huge key", "https://push.example/abc", strings.Repeat("k", MaxKeyLength+1), "secret", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := CleanSubscription(tt.endpoint, tt.p256dh, tt.auth)
			if (err == nil) != tt.ok {
				t.Errorf("err = %v, want ok = %v", err, tt.ok)
			}
		})
	}
}

func TestCleanMessage(t *testing.T) {
	message, err := CleanMessage("  План готов ", "Откройте", "")
	if err != nil || message.Title != "План готов" || message.URL != DefaultURL {
		t.Fatalf("message = %+v, err = %v", message, err)
	}
	for name, input := range map[string][3]string{
		"empty title":  {"", "x", ""},
		"long title":   {strings.Repeat("я", MaxTitleRunes+1), "x", ""},
		"long body":    {"t", strings.Repeat("я", MaxBodyRunes+1), ""},
		"absolute url": {"t", "x", "https://evil.example/"},
		"root url":     {"t", "x", "/admin"},
	} {
		if _, err := CleanMessage(input[0], input[1], input[2]); err == nil {
			t.Errorf("%s must be rejected", name)
		}
	}
	if _, err := CleanMessage("t", "x", "./?screen=today"); err != nil {
		t.Errorf("relative url must pass: %v", err)
	}
}

func TestMemoryKeepsNewestSubscriptionsPerMaster(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	start := time.Now()
	for index := range MaxSubscriptionsPerMaster + 3 {
		endpoint := "https://push.example/" + string(rune('a'+index))
		if err := store.Save(ctx, "anna", Subscription{Endpoint: endpoint, P256dh: "k", Auth: "a"}, start.Add(time.Duration(index)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Save(ctx, "olga", Subscription{Endpoint: "https://push.example/olga", P256dh: "k", Auth: "a"}, start); err != nil {
		t.Fatal(err)
	}

	anna, _ := store.List(ctx, "anna")
	olga, _ := store.List(ctx, "olga")
	if len(anna) != MaxSubscriptionsPerMaster || len(olga) != 1 {
		t.Fatalf("anna = %d, olga = %d", len(anna), len(olga))
	}
	if anna[0].Endpoint != "https://push.example/"+string(rune('a'+MaxSubscriptionsPerMaster+2)) {
		t.Errorf("newest first, got %s", anna[0].Endpoint)
	}
}

func TestMemoryRemoveChecksOwner(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	_ = store.Save(ctx, "anna", Subscription{Endpoint: "https://push.example/a", P256dh: "k", Auth: "a"}, time.Now())

	_ = store.Remove(ctx, "olga", "https://push.example/a")
	if list, _ := store.List(ctx, "anna"); len(list) != 1 {
		t.Fatal("another master must not remove the subscription")
	}
	_ = store.Remove(ctx, "anna", "https://push.example/a")
	if list, _ := store.List(ctx, "anna"); len(list) != 0 {
		t.Fatal("owner must remove the subscription")
	}
}

func TestNewReturnsNilWithoutKeys(t *testing.T) {
	if New(NewMemory(), "", "private", "https://example.test/") != nil || New(NewMemory(), "public", "", "https://example.test/") != nil {
		t.Fatal("service must be off without both keys")
	}
}

func TestSendDeliversEncryptedPayloadAndPrunesGoneEndpoints(t *testing.T) {
	var received atomic.Int32
	var gotAuth atomic.Value
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		gotAuth.Store(r.Header.Get("Authorization"))
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer live.Close()
	gone := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer gone.Close()

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	store := NewMemory()
	ctx := context.Background()
	p256dh, secret := browserKeys(t)
	_ = store.Save(ctx, "anna", Subscription{Endpoint: live.URL + "/live", P256dh: p256dh, Auth: secret}, time.Now().Add(-time.Minute))
	_ = store.Save(ctx, "anna", Subscription{Endpoint: gone.URL + "/gone", P256dh: p256dh, Auth: secret}, time.Now())
	service := New(store, publicKey, privateKey, "https://example.test/")

	delivered, err := service.Send(ctx, "anna", Message{Title: "План готов", Body: "Откройте", URL: "./"})
	if err != nil {
		t.Fatal(err)
	}

	if delivered != 1 || received.Load() != 1 {
		t.Errorf("delivered = %d, received = %d", delivered, received.Load())
	}
	if auth, _ := gotAuth.Load().(string); !strings.HasPrefix(auth, "vapid t=") {
		t.Errorf("authorization = %q", auth)
	}
	left, _ := store.List(ctx, "anna")
	if len(left) != 1 || !strings.HasSuffix(left[0].Endpoint, "/live") {
		t.Errorf("gone endpoint must be pruned, left = %+v", left)
	}
}

func TestPayloadShapeForAngularServiceWorker(t *testing.T) {
	body, err := json.Marshal(payload{Notification: notification{
		Title: "План готов",
		Body:  "Откройте",
		Icon:  IconPath,
		Data: notificationData{OnActionClick: map[string]actionClick{
			ActionDefault: {Operation: ActionOpen, URL: "./"},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"notification":{"title":"План готов","body":"Откройте","icon":"icons/icon-192x192.png","data":{"onActionClick":{"default":{"operation":"navigateLastFocusedOrOpen","url":"./"}}}}}`
	if string(body) != want {
		t.Errorf("payload = %s", body)
	}
}
