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

	"post-helper/server/internal/intake"
	"post-helper/server/internal/refs"
)

type fakeNotifier struct {
	mu    sync.Mutex
	sent  []string
	reach chan struct{}
}

func (f *fakeNotifier) Notify(_ context.Context, text string) error {
	f.mu.Lock()
	f.sent = append(f.sent, text)
	f.mu.Unlock()
	f.reach <- struct{}{}
	return nil
}

func (f *fakeNotifier) wait(t *testing.T) string {
	t.Helper()
	select {
	case <-f.reach:
	case <-time.After(2 * time.Second):
		t.Fatal("owner was not notified")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sent[len(f.sent)-1]
}

type intakeFixture struct {
	*accountFixture
	notifier *fakeNotifier
	refs     *refs.Memory
}

func newIntakeFixture(t *testing.T) *intakeFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	notifier := &fakeNotifier{reach: make(chan struct{}, 4)}
	store := refs.NewMemory()
	base.handler = bothHandlers(Options{
		Accounts:       base.store,
		Refs:           store,
		Intake:         intake.NewMemory(),
		Notifier:       notifier,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &intakeFixture{accountFixture: base, notifier: notifier, refs: store}
}

const intakeBody = `{"links":["instagram.com/anna_nails","https://vk.com/anna"],"goals":["reach","check"],"note":"Без танцев, больше про окрашивание"}`

const planJSON = `{
	"note": "План на месяц готов",
	"strategy": {"summary":"Эксперт по окрашиванию","positioning":"Блонд без желтизны","profileFixes":[],
		"pillars":[{"title":"Процесс","description":"Работа","ideas":["Тонирование"]}],
		"cadence":{"reels":2,"posts":1,"stories":3,"note":""},"firstSteps":["Обновить аватар"]},
	"calendar": {"startedOn":"2026-10-23","schedule":{"slots":[{"weekday":1,"time":"11:00"}],"publishTime":"19:00"},
		"items":[{"id":"w1-a","date":"2026-10-26","time":"19:00","format":"reels","pillar":"Процесс","idea":"Тонирование","done":false}]}
}`

func TestMasterSubmitsRequestAndOwnerIsNotified(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/intake", code, intakeBody)
	sent := fixture.notifier.wait(t)
	latest := fixture.call(http.MethodGet, "/api/intake", code, "")

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"new"`) {
		t.Fatalf("submit = %d %s", response.Code, response.Body)
	}
	for _, want := range []string{"Новая заявка", "Анна", "Instagram*: https://instagram.com/anna_nails", "запрещённой", "ВКонтакте", "Увеличить охваты", "Без танцев"} {
		if !strings.Contains(sent, want) {
			t.Errorf("notification lacks %q:\n%s", want, sent)
		}
	}
	if latest.Code != http.StatusOK || !strings.Contains(latest.Body.String(), "Без танцев, больше про окрашивание") {
		t.Errorf("latest = %d %s", latest.Code, latest.Body)
	}
}

func TestSubmitRejectsBadInput(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")
	cases := map[string]string{
		"no links":     `{"links":[],"goals":["reach"]}`,
		"bad link":     `{"links":["анна"],"goals":["reach"]}`,
		"no goals":     `{"links":["vk.com/anna"],"goals":[]}`,
		"unknown goal": `{"links":["vk.com/anna"],"goals":["magic"]}`,
		"not json":     `nope`,
	}
	for name, body := range cases {
		if response := fixture.call(http.MethodPost, "/api/intake", code, body); response.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d %s", name, response.Code, response.Body)
		}
	}
}

func TestIntakeRoutesNeedALogin(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")

	cases := []struct {
		name, method, path, token string
		want                      int
	}{
		{"anonymous cannot submit", http.MethodPost, "/api/intake", "", http.StatusUnauthorized},
		{"no request yet", http.MethodGet, "/api/intake", code, http.StatusNoContent},
	}
	for _, tc := range cases {
		if got := fixture.call(tc.method, tc.path, tc.token, "").Code; got != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestOwnerSeesRequestWithMasterName(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/intake", code, intakeBody)
	fixture.notifier.wait(t)

	list := fixture.call(http.MethodGet, "/api/admin/intakes?status=new", testPassword, "")

	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"masterName":"Анна"`) ||
		!strings.Contains(list.Body.String(), "Без танцев") {
		t.Errorf("list = %d %s", list.Code, list.Body)
	}
}

func TestOwnerDeliversPlanAndRequestBecomesReady(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/intake", code, intakeBody)
	fixture.notifier.wait(t)

	delivered := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)
	latest := fixture.call(http.MethodGet, "/api/intake", code, "")
	state := fixture.call(http.MethodGet, "/api/state", code, "")

	if delivered.Code != http.StatusOK || !strings.Contains(delivered.Body.String(), `"items":1`) {
		t.Fatalf("deliver = %d %s", delivered.Code, delivered.Body)
	}
	if !strings.Contains(latest.Body.String(), `"status":"ready"`) || !strings.Contains(latest.Body.String(), "План на месяц готов") {
		t.Errorf("latest = %s", latest.Body)
	}
	for _, want := range []string{`\"strategy\"`, `"strategy"`, `"calendar"`, "Блонд без желтизны"} {
		if strings.Contains(state.Body.String(), want) {
			return
		}
	}
	t.Errorf("state lacks the plan: %s", state.Body)
}

func TestDeliverPlanRejectsBrokenPlan(t *testing.T) {
	fixture := newIntakeFixture(t)
	_, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword,
		`{"calendar":{"startedOn":"2026-10-23","schedule":{"slots":[],"publishTime":"19:00"},"items":[{"id":"a","date":"2026-10-26","time":"19:00","format":"podcast","pillar":"x","idea":"y"}]}}`)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "format") {
		t.Errorf("deliver = %d %s", response.Code, response.Body)
	}
}

func (f *intakeFixture) deliverRefs(masterID, key string, files [][]byte) *httptest.ResponseRecorder {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField(FieldData, `["Крупный план рук"]`)
	for index, data := range files {
		part, _ := writer.CreateFormFile(FieldFiles, "ref"+string(rune('0'+index)))
		_, _ = part.Write(data)
	}
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/admin/masters/"+masterID+"/refs/"+key, body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", BearerPrefix+testPassword)
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func TestOwnerDeliversReferencesForCalendarItem(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	missing := fixture.deliverRefs(master.ID, "no-such-item", [][]byte{pngBytes})
	delivered := fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes, pngBytes})
	statuses := fixture.call(http.MethodGet, "/api/refs/status", code, "")
	var parsed []refs.Status
	_ = json.Unmarshal(statuses.Body.Bytes(), &parsed)

	if missing.Code != http.StatusNotFound {
		t.Errorf("missing = %d %s", missing.Code, missing.Body)
	}
	if delivered.Code != http.StatusOK || len(parsed) != 1 {
		t.Fatalf("delivered = %d %s, statuses = %s", delivered.Code, delivered.Body, statuses.Body)
	}
	if parsed[0].Key != "w1-a" || parsed[0].Status != refs.StatusDone || len(parsed[0].Files) != 2 ||
		parsed[0].Files[0].Caption != "Крупный план рук" || parsed[0].Date != "2026-10-26" {
		t.Errorf("status = %+v", parsed[0])
	}
}

func TestOwnerClearsAllReferencesOfMaster(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)
	fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes})

	cleared := fixture.call(http.MethodDelete, "/api/admin/masters/"+master.ID+"/refs", testPassword, "")
	statuses := fixture.call(http.MethodGet, "/api/refs/status", code, "")
	var parsed []refs.Status
	_ = json.Unmarshal(statuses.Body.Bytes(), &parsed)

	if cleared.Code != http.StatusNoContent || len(parsed) != 0 {
		t.Errorf("cleared = %d, statuses = %s", cleared.Code, statuses.Body)
	}
	if again := fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes}); again.Code != http.StatusOK {
		t.Errorf("deliver after clear = %d %s", again.Code, again.Body)
	}
}

func TestDeliverRefsRejectsWrongFiles(t *testing.T) {
	fixture := newIntakeFixture(t)
	_, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	none := fixture.deliverRefs(master.ID, "w1-a", nil)
	text := fixture.deliverRefs(master.ID, "w1-a", [][]byte{[]byte("not an image")})
	many := fixture.deliverRefs(master.ID, "w1-a", [][]byte{pngBytes, pngBytes, pngBytes, pngBytes})

	if none.Code != http.StatusBadRequest || text.Code != http.StatusUnsupportedMediaType || many.Code != http.StatusBadRequest {
		t.Errorf("none %d, text %d, many %d", none.Code, text.Code, many.Code)
	}
}
