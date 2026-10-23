package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/push"
)

type fakePusher struct {
	mu        sync.Mutex
	delivered int
	messages  []push.Message
	masters   []string
	sent      chan struct{}
}

func newFakePusher(delivered int) *fakePusher {
	return &fakePusher{delivered: delivered, sent: make(chan struct{}, 4)}
}

func (f *fakePusher) PublicKey() string { return "public-key" }

func (f *fakePusher) Send(_ context.Context, masterID string, message push.Message) (int, error) {
	f.mu.Lock()
	f.messages = append(f.messages, message)
	f.masters = append(f.masters, masterID)
	f.mu.Unlock()
	f.sent <- struct{}{}
	return f.delivered, nil
}

type pushFixture struct {
	handler  http.Handler
	accounts *accounts.Memory
	store    *push.Memory
}

func newPushFixture(t *testing.T, pusher push.Sender) *pushFixture {
	t.Helper()
	fixture := &pushFixture{accounts: accounts.NewMemory(), store: push.NewMemory()}
	fixture.handler = NewHandler(Options{
		Accounts:       fixture.accounts,
		PushStore:      fixture.store,
		Pusher:         pusher,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return fixture
}

func (f *pushFixture) master(t *testing.T, name string) (string, accounts.Master) {
	t.Helper()
	code, err := auth.GenerateCode()
	if err != nil {
		t.Fatal(err)
	}
	master, err := f.accounts.CreateMaster(context.Background(), name, auth.HashCode(code))
	if err != nil {
		t.Fatal(err)
	}
	return code, master
}

func (f *pushFixture) call(method, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

const subscriptionJSON = `{"endpoint":"https://push.example/abc","keys":{"p256dh":"BKey","auth":"secret"}}`

func TestPushKey(t *testing.T) {
	off := newPushFixture(t, nil)
	offCode, _ := off.master(t, "Анна")
	on := newPushFixture(t, newFakePusher(1))
	onCode, _ := on.master(t, "Анна")

	disabled := off.call(http.MethodGet, "/api/push/key", offCode, "")
	enabled := on.call(http.MethodGet, "/api/push/key", onCode, "")
	anonymous := on.call(http.MethodGet, "/api/push/key", "", "")
	admin := on.call(http.MethodGet, "/api/push/key", testPassword, "")

	if disabled.Code != http.StatusServiceUnavailable {
		t.Errorf("off = %d", disabled.Code)
	}
	if enabled.Code != http.StatusOK || !strings.Contains(enabled.Body.String(), `"publicKey":"public-key"`) {
		t.Errorf("on = %d %s", enabled.Code, enabled.Body)
	}
	if anonymous.Code != http.StatusUnauthorized || admin.Code != http.StatusForbidden {
		t.Errorf("anonymous = %d, admin = %d", anonymous.Code, admin.Code)
	}
}

func TestPushSubscribeAndUnsubscribe(t *testing.T) {
	fixture := newPushFixture(t, newFakePusher(1))
	code, master := fixture.master(t, "Анна")
	otherCode, other := fixture.master(t, "Ольга")

	saved := fixture.call(http.MethodPost, "/api/push/subscribe", code, subscriptionJSON)
	stored, _ := fixture.store.List(context.Background(), master.ID)
	insecure := fixture.call(http.MethodPost, "/api/push/subscribe", code,
		`{"endpoint":"http://push.example/abc","keys":{"p256dh":"BKey","auth":"secret"}}`)
	garbage := fixture.call(http.MethodPost, "/api/push/subscribe", code, `{`)
	foreign := fixture.call(http.MethodPost, "/api/push/unsubscribe", otherCode, `{"endpoint":"https://push.example/abc"}`)
	stillThere, _ := fixture.store.List(context.Background(), master.ID)
	removed := fixture.call(http.MethodPost, "/api/push/unsubscribe", code, `{"endpoint":"https://push.example/abc"}`)
	gone, _ := fixture.store.List(context.Background(), master.ID)

	if saved.Code != http.StatusNoContent || len(stored) != 1 || stored[0].P256dh != "BKey" || stored[0].Auth != "secret" {
		t.Fatalf("saved = %d, stored = %+v", saved.Code, stored)
	}
	if insecure.Code != http.StatusBadRequest || garbage.Code != http.StatusBadRequest {
		t.Errorf("insecure = %d, garbage = %d", insecure.Code, garbage.Code)
	}
	if foreign.Code != http.StatusNoContent || len(stillThere) != 1 {
		t.Errorf("another master must not remove it: %d, left %d", foreign.Code, len(stillThere))
	}
	if removed.Code != http.StatusNoContent || len(gone) != 0 {
		t.Errorf("removed = %d, left %d", removed.Code, len(gone))
	}
	if list, _ := fixture.store.List(context.Background(), other.ID); len(list) != 0 {
		t.Errorf("other master got %d subscriptions", len(list))
	}
}

func TestPushSubscribeWhenOff(t *testing.T) {
	fixture := newPushFixture(t, nil)
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/push/subscribe", code, subscriptionJSON)

	if response.Code != http.StatusServiceUnavailable {
		t.Errorf("subscribe when off = %d", response.Code)
	}
}

func TestOwnerSendsPushToMaster(t *testing.T) {
	pusher := newFakePusher(2)
	fixture := newPushFixture(t, pusher)
	code, master := fixture.master(t, "Анна")
	path := "/api/admin/masters/" + master.ID + "/push"

	denied := fixture.call(http.MethodPost, path, code, `{"title":"Привет"}`)
	empty := fixture.call(http.MethodPost, path, testPassword, `{"title":" "}`)
	foreignURL := fixture.call(http.MethodPost, path, testPassword, `{"title":"Привет","url":"https://evil.example/"}`)
	sent := fixture.call(http.MethodPost, path, testPassword, `{"title":"Привет","body":"Текст"}`)

	if denied.Code != http.StatusForbidden {
		t.Errorf("master = %d", denied.Code)
	}
	if empty.Code != http.StatusBadRequest || foreignURL.Code != http.StatusBadRequest {
		t.Errorf("empty = %d, foreign url = %d", empty.Code, foreignURL.Code)
	}
	if sent.Code != http.StatusOK || !strings.Contains(sent.Body.String(), `"sent":2`) {
		t.Fatalf("sent = %d %s", sent.Code, sent.Body)
	}
	if len(pusher.messages) != 1 || pusher.masters[0] != master.ID ||
		pusher.messages[0].Title != "Привет" || pusher.messages[0].URL != push.DefaultURL {
		t.Errorf("messages = %+v to %v", pusher.messages, pusher.masters)
	}
}

func TestPlanDeliveryPushesMaster(t *testing.T) {
	pusher := newFakePusher(1)
	fixture := newPushFixture(t, pusher)
	_, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	if response.Code != http.StatusOK {
		t.Fatalf("plan = %d %s", response.Code, response.Body)
	}
	select {
	case <-pusher.sent:
	case <-time.After(2 * time.Second):
		t.Fatal("master was not notified about the plan")
	}
	pusher.mu.Lock()
	defer pusher.mu.Unlock()
	if pusher.masters[0] != master.ID || pusher.messages[0].Title != PushPlanTitle {
		t.Errorf("pushed %+v to %v", pusher.messages, pusher.masters)
	}
}

func TestPlanDeliveryWorksWithoutPush(t *testing.T) {
	fixture := newPushFixture(t, nil)
	_, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	if response.Code != http.StatusOK {
		t.Errorf("plan without push = %d %s", response.Code, response.Body)
	}
}
