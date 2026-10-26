package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
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
	fixture.handler = bothHandlers(Options{
		Accounts:       fixture.accounts,
		PushStore:      fixture.store,
		Pusher:         pusher,
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

	if disabled.Code != http.StatusServiceUnavailable {
		t.Errorf("off = %d", disabled.Code)
	}
	if enabled.Code != http.StatusOK || !strings.Contains(enabled.Body.String(), `"publicKey":"public-key"`) {
		t.Errorf("on = %d %s", enabled.Code, enabled.Body)
	}
	if anonymous.Code != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", anonymous.Code)
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
	_, master := fixture.master(t, "Анна")
	path := "/api/admin/masters/" + master.ID + "/push"

	empty := fixture.call(http.MethodPost, path, testPassword, `{"title":" "}`)
	foreignURL := fixture.call(http.MethodPost, path, testPassword, `{"title":"Привет","url":"https://evil.example/"}`)
	sent := fixture.call(http.MethodPost, path, testPassword, `{"title":"Привет","body":"Текст"}`)

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
	if pusher.masters[0] != master.ID || pusher.messages[0].Title != PushPlanTitle ||
		pusher.messages[0].Topic.Kind != push.KindPlan || pusher.messages[0].Topic.PlanStart != "2026-10-23" {
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

const twoItemPlanJSON = `{
	"note": "План готов, референсы делаются",
	"strategy": {"summary":"Эксперт","positioning":"Спокойно","profileFixes":[],
		"pillars":[{"title":"Процесс","description":"Работа","ideas":["Разбор"]}],
		"cadence":{"reels":1,"posts":1,"stories":0,"note":""},"firstSteps":["Обновить шапку"]},
	"calendar": {"startedOn":"2026-10-23","schedule":{"slots":[{"weekday":1,"time":"11:00"}],"publishTime":"19:00"},
		"items":[
			{"id":"w1-a","date":"2026-10-27","time":"19:00","format":"post","pillar":"Процесс","idea":"Разбор спины","done":false},
			{"id":"w1-b","date":"2026-10-29","time":"19:00","format":"stories","pillar":"Процесс","idea":"Почему болит","done":false}
		]}
}`

type refsPushFixture struct {
	*pushFixture
	pusher *fakePusher
}

func newRefsPushFixture(t *testing.T) *refsPushFixture {
	t.Helper()
	pusher := newFakePusher(1)
	base := &pushFixture{accounts: accounts.NewMemory(), store: push.NewMemory()}
	planner := &fakePlanner{plan: refs.Plan{Prompts: []refs.Prompt{
		{Prompt: "back massage, hands, close up", Caption: "Руки"},
		{Prompt: "spine model on a desk", Caption: "Модель позвоночника"},
		{Prompt: "towel and oil", Caption: "Полотенце и масло"},
	}}}
	base.handler = bothHandlers(Options{
		Accounts:       base.accounts,
		PushStore:      base.store,
		Pusher:         pusher,
		Refs:           refs.NewMemory(),
		RefPlanner:     planner,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &refsPushFixture{pushFixture: base, pusher: pusher}
}

func (f *refsPushFixture) claim(t *testing.T) RefAgentItem {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/agent/refs/next", agentToken, "")
	var item RefAgentItem
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &item) != nil {
		t.Fatalf("claim = %d %s", recorder.Code, recorder.Body)
	}
	return item
}

func (f *refsPushFixture) upload(t *testing.T, id string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile(FieldFiles, "ref0")
	_, _ = part.Write(pngBytes)
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/agent/refs/"+id+"/result", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", BearerPrefix+agentToken)
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", recorder.Code, recorder.Body)
	}
}

func (f *refsPushFixture) fail(t *testing.T, id string, final bool) {
	t.Helper()
	body := `{"reason":"не получилось","final":false}`
	if final {
		body = `{"reason":"не получилось","final":true}`
	}
	if recorder := f.call(http.MethodPost, "/api/agent/refs/"+id+"/fail", agentToken, body); recorder.Code != http.StatusOK {
		t.Fatalf("fail = %d %s", recorder.Code, recorder.Body)
	}
}

func (f *refsPushFixture) deliverPlan(t *testing.T, masterID string) {
	t.Helper()
	response := f.call(http.MethodPost, "/api/admin/masters/"+masterID+"/plan", testPassword, twoItemPlanJSON)
	if response.Code != http.StatusOK {
		t.Fatalf("plan = %d %s", response.Code, response.Body)
	}
}

func (f *refsPushFixture) expectPush(t *testing.T) push.Message {
	t.Helper()
	select {
	case <-f.pusher.sent:
	case <-time.After(2 * time.Second):
		t.Fatal("master was not notified")
	}
	f.pusher.mu.Lock()
	defer f.pusher.mu.Unlock()
	return f.pusher.messages[len(f.pusher.messages)-1]
}

func (f *refsPushFixture) expectSilence(t *testing.T) {
	t.Helper()
	select {
	case <-f.pusher.sent:
		t.Fatalf("unexpected push: %+v", f.pusher.messages)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestPlanDeliveryOrdersReferencesAndStaysQuiet(t *testing.T) {
	fixture := newRefsPushFixture(t)
	code, master := fixture.master(t, "Анна")

	fixture.deliverPlan(t, master.ID)
	statuses := fixture.call(http.MethodGet, "/api/refs/status", code, "")

	var parsed []refs.Status
	if err := json.Unmarshal(statuses.Body.Bytes(), &parsed); err != nil || len(parsed) != 2 {
		t.Fatalf("statuses = %s", statuses.Body)
	}
	for _, status := range parsed {
		if status.Status != refs.StatusQueued {
			t.Errorf("%s is %s, want queued", status.Key, status.Status)
		}
	}
	fixture.expectSilence(t)
}

func TestMasterIsNotifiedWhenTheLastReferenceIsReady(t *testing.T) {
	fixture := newRefsPushFixture(t)
	_, master := fixture.master(t, "Анна")
	fixture.deliverPlan(t, master.ID)

	fixture.upload(t, fixture.claim(t).ID)
	fixture.expectSilence(t)
	fixture.upload(t, fixture.claim(t).ID)
	message := fixture.expectPush(t)

	if message.Title != PushRefsTitle || message.URL != PushRefsURL || message.Topic.Kind != push.KindRefs || message.Topic.PlanStart == "" {
		t.Errorf("message = %+v", message)
	}
	fixture.pusher.mu.Lock()
	defer fixture.pusher.mu.Unlock()
	if len(fixture.pusher.messages) != 1 || fixture.pusher.masters[0] != master.ID {
		t.Errorf("pushed %+v to %v", fixture.pusher.messages, fixture.pusher.masters)
	}
}

func TestMasterIsNotifiedWhenTheRestFailedButSomeAreReady(t *testing.T) {
	fixture := newRefsPushFixture(t)
	_, master := fixture.master(t, "Анна")
	fixture.deliverPlan(t, master.ID)

	fixture.upload(t, fixture.claim(t).ID)
	fixture.fail(t, fixture.claim(t).ID, true)

	if message := fixture.expectPush(t); message.Title != PushRefsTitle {
		t.Errorf("message = %+v", message)
	}
}

func TestMasterIsNotNotifiedWhenNothingIsReady(t *testing.T) {
	fixture := newRefsPushFixture(t)
	_, master := fixture.master(t, "Анна")
	fixture.deliverPlan(t, master.ID)

	fixture.fail(t, fixture.claim(t).ID, true)
	fixture.fail(t, fixture.claim(t).ID, true)

	fixture.expectSilence(t)
}

func TestMasterIsNotNotifiedWhileAFailedReferenceWillBeRetried(t *testing.T) {
	fixture := newRefsPushFixture(t)
	_, master := fixture.master(t, "Анна")
	fixture.deliverPlan(t, master.ID)

	fixture.upload(t, fixture.claim(t).ID)
	fixture.fail(t, fixture.claim(t).ID, false)

	fixture.expectSilence(t)
}
