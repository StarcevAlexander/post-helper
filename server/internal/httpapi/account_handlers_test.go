package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
)

type accountFixture struct {
	handler http.Handler
	store   *accounts.Memory
}

func newAccountFixture(t *testing.T, dailyLimit int) *accountFixture {
	t.Helper()
	fixture := &accountFixture{
		store: accounts.NewMemory(),
	}
	fixture.handler = NewHandler(Options{
		Accounts:       fixture.store,
		DailyAILimit:   dailyLimit,
		RetentionDays:  1095,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return fixture
}

func (f *accountFixture) master(t *testing.T, name string) (string, accounts.Master) {
	t.Helper()
	code, err := auth.GenerateCode()
	if err != nil {
		t.Fatal(err)
	}
	master, err := f.store.CreateMaster(context.Background(), name, auth.HashCode(code))
	if err != nil {
		t.Fatal(err)
	}
	return code, master
}

func (f *accountFixture) call(method, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func TestMe(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	admin := fixture.call(http.MethodGet, "/api/me", testPassword, "")
	master := fixture.call(http.MethodGet, "/api/me", code, "")

	if !strings.Contains(admin.Body.String(), `"role":"admin"`) {
		t.Errorf("admin = %s", admin.Body)
	}
	for _, want := range []string{`"role":"master"`, `"name":"Анна"`, `"dailyLimit":5`, `"usageToday":0`, `"retentionDays":1095`} {
		if !strings.Contains(master.Body.String(), want) {
			t.Errorf("master %s lacks %s", master.Body, want)
		}
	}
}

func TestRenameMaster(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/me/name", code, `{"name":"  Мария  "}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"name":"Мария"`) {
		t.Fatalf("rename = %d %s", response.Code, response.Body)
	}
	if me := fixture.call(http.MethodGet, "/api/me", code, ""); !strings.Contains(me.Body.String(), `"name":"Мария"`) {
		t.Errorf("me after rename = %s", me.Body)
	}
}

func TestRenameMasterRefusals(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")
	tooLong := `{"name":"` + strings.Repeat("я", MaxMasterNameRunes+1) + `"}`

	cases := map[string]struct {
		token, body string
		want        int
	}{
		"empty name": {code, `{"name":"   "}`, http.StatusBadRequest},
		"too long":   {code, tooLong, http.StatusBadRequest},
		"bad json":   {code, `{`, http.StatusBadRequest},
		"no token":   {"", `{"name":"Мария"}`, http.StatusUnauthorized},
		"owner":      {testPassword, `{"name":"Мария"}`, http.StatusForbidden},
	}
	for name, tc := range cases {
		if got := fixture.call(http.MethodPost, "/api/me/name", tc.token, tc.body).Code; got != tc.want {
			t.Errorf("%s: status = %d, want %d", name, got, tc.want)
		}
	}
}

func TestAuthRefusals(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, master := fixture.master(t, "Анна")
	_ = fixture.store.SetDisabled(context.Background(), master.ID, true)

	for name, token := range map[string]string{"no token": "", "wrong": "wrong", "disabled master": code} {
		if got := fixture.call(http.MethodGet, "/api/me", token, "").Code; got != http.StatusUnauthorized {
			t.Errorf("%s: status = %d", name, got)
		}
	}
}

func TestOwnerOnlyEndpointsRefuseMasters(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/history"},
		{http.MethodGet, "/api/events"},
		{http.MethodGet, "/api/errors"},
		{http.MethodGet, "/api/admin/masters"},
		{http.MethodPost, "/api/admin/masters"},
		{http.MethodPost, "/api/admin/masters/x/disabled"},
	} {
		if got := fixture.call(route.method, route.path, code, `{"name":"x"}`).Code; got != http.StatusForbidden {
			t.Errorf("%s %s: status = %d, want 403", route.method, route.path, got)
		}
	}
}

func TestMasterDataEndpointsRefuseTheOwner(t *testing.T) {
	fixture := newAccountFixture(t, 5)

	for _, method := range []string{http.MethodGet, http.MethodPut} {
		if got := fixture.call(method, "/api/state", testPassword, `{"baseVersion":0,"data":{}}`).Code; got != http.StatusForbidden {
			t.Errorf("%s: status = %d", method, got)
		}
	}
}

func TestStateRoundTripAndConflict(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	empty := fixture.call(http.MethodGet, "/api/state", code, "")
	first := fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"onboarding":{"index":3}}}`)
	second := fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":1,"data":{"onboarding":{"index":4}}}`)
	stale := fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":1,"data":{"x":1}}`)
	read := fixture.call(http.MethodGet, "/api/state", code, "")

	if !strings.Contains(empty.Body.String(), `"version":0`) || !strings.Contains(empty.Body.String(), `"data":null`) {
		t.Errorf("empty = %s", empty.Body)
	}
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"version":1`) {
		t.Errorf("first = %d %s", first.Code, first.Body)
	}
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"version":2`) {
		t.Errorf("second = %d %s", second.Code, second.Body)
	}
	if stale.Code != http.StatusConflict || !strings.Contains(stale.Body.String(), `"version":2`) || !strings.Contains(stale.Body.String(), `"index":4`) {
		t.Errorf("stale = %d %s", stale.Code, stale.Body)
	}
	var state accounts.State
	if err := json.Unmarshal(read.Body.Bytes(), &state); err != nil || state.Version != 2 || !strings.Contains(string(state.Data), `"index":4`) {
		t.Errorf("read = %s", read.Body)
	}
}

func TestStateIsPrivateToEachMaster(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	anna, _ := fixture.master(t, "Анна")
	vera, _ := fixture.master(t, "Вера")
	fixture.call(http.MethodPut, "/api/state", anna, `{"baseVersion":0,"data":{"secret":"anna"}}`)

	got := fixture.call(http.MethodGet, "/api/state", vera, "")

	if strings.Contains(got.Body.String(), "anna") || !strings.Contains(got.Body.String(), `"version":0`) {
		t.Errorf("vera sees %s", got.Body)
	}
}

func TestStateRejectsBadBodies(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")
	big := `{"baseVersion":0,"data":{"x":"` + strings.Repeat("я", int(MaxStateBodyBytes)) + `"}}`

	for name, body := range map[string]string{
		"not json":     `nope`,
		"array":        `{"baseVersion":0,"data":[1]}`,
		"string":       `{"baseVersion":0,"data":"x"}`,
		"missing data": `{"baseVersion":0}`,
		"negative":     `{"baseVersion":-1,"data":{}}`,
		"too large":    big,
	} {
		if got := fixture.call(http.MethodPut, "/api/state", code, body).Code; got != http.StatusBadRequest {
			t.Errorf("%s: status = %d", name, got)
		}
	}
}

func TestAdminCreatesListsAndDisablesMasters(t *testing.T) {
	fixture := newAccountFixture(t, 5)

	created := fixture.call(http.MethodPost, "/api/admin/masters", testPassword, `{"name":"  Анна  "}`)
	var response CreateMasterResponse
	if err := json.Unmarshal(created.Body.Bytes(), &response); err != nil || response.Code == "" || response.Master.Name != "Анна" {
		t.Fatalf("created = %d %s", created.Code, created.Body)
	}

	if fixture.call(http.MethodGet, "/api/me", response.Code, "").Code != http.StatusOK {
		t.Error("the new code must log in")
	}
	list := fixture.call(http.MethodGet, "/api/admin/masters", testPassword, "")
	if !strings.Contains(list.Body.String(), `"name":"Анна"`) || strings.Contains(list.Body.String(), response.Code) {
		t.Errorf("list = %s", list.Body)
	}

	off := fixture.call(http.MethodPost, "/api/admin/masters/"+response.Master.ID+"/disabled", testPassword, `{"disabled":true}`)
	if off.Code != http.StatusOK || fixture.call(http.MethodGet, "/api/me", response.Code, "").Code != http.StatusUnauthorized {
		t.Error("a disabled master must be logged out")
	}
	on := fixture.call(http.MethodPost, "/api/admin/masters/"+response.Master.ID+"/disabled", testPassword, `{"disabled":false}`)
	if on.Code != http.StatusOK || fixture.call(http.MethodGet, "/api/me", response.Code, "").Code != http.StatusOK {
		t.Error("an enabled master must log in again")
	}
}

func TestAdminMasterRejections(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	tests := []struct {
		name, method, path, body string
		want                     int
	}{
		{"no name", http.MethodPost, "/api/admin/masters", `{"name":"  "}`, http.StatusBadRequest},
		{"long name", http.MethodPost, "/api/admin/masters", `{"name":"` + strings.Repeat("я", MaxMasterNameRunes+1) + `"}`, http.StatusBadRequest},
		{"bad json", http.MethodPost, "/api/admin/masters", `nope`, http.StatusBadRequest},
		{"unknown master", http.MethodPost, "/api/admin/masters/missing/disabled", `{"disabled":true}`, http.StatusNotFound},
		{"bad disable body", http.MethodPost, "/api/admin/masters/x/disabled", `nope`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := fixture.call(tt.method, tt.path, testPassword, tt.body).Code; got != tt.want {
				t.Errorf("status = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestAdminSeesTheJournalAndTheVersionsOfAMaster(t *testing.T) {
	fixture := newAccountFixture(t, 50)
	code, master := fixture.master(t, "Анна")
	_ = fixture.store.RecordEvent(context.Background(), master.ID, EventPlanDelivered, json.RawMessage(`{"items":4}`), time.Now())
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"a":1}}`)
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":1,"data":{"a":2}}`)

	events := fixture.call(http.MethodGet, "/api/admin/masters/"+master.ID+"/events?limit=10", testPassword, "")
	versions := fixture.call(http.MethodGet, "/api/admin/masters/"+master.ID+"/versions", testPassword, "")

	if events.Code != http.StatusOK || !strings.Contains(events.Body.String(), `"kind":"plan.delivered"`) {
		t.Errorf("events = %d %s", events.Code, events.Body)
	}
	if versions.Code != http.StatusOK || !strings.Contains(versions.Body.String(), `"version":2`) || !strings.Contains(versions.Body.String(), `"version":1`) {
		t.Errorf("versions = %d %s", versions.Code, versions.Body)
	}
	if got := fixture.call(http.MethodGet, "/api/admin/masters/"+master.ID+"/events", code, "").Code; got != http.StatusForbidden {
		t.Errorf("a master must not read the journal, status = %d", got)
	}
}

func TestAdminExportsEverythingAsAFile(t *testing.T) {
	fixture := newAccountFixture(t, 50)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"a":1}}`)
	_ = fixture.store.RecordEvent(context.Background(), master.ID, EventPlanDelivered, json.RawMessage(`{"items":4}`), time.Now())

	recorder := fixture.call(http.MethodGet, "/api/admin/masters/"+master.ID+"/export", testPassword, "")

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("status = %d, headers = %v", recorder.Code, recorder.Header())
	}
	for _, want := range []string{`"name":"Анна"`, `"history"`, `"events"`, `"kind":"plan.delivered"`, `"a":1`} {
		if !strings.Contains(recorder.Body.String(), want) {
			t.Errorf("export lacks %s", want)
		}
	}
	if got := fixture.call(http.MethodGet, "/api/admin/masters/missing/export", testPassword, "").Code; got != http.StatusNotFound {
		t.Errorf("unknown master: status = %d", got)
	}
}

func TestAdminRestoresAnOlderVersionAsANewOne(t *testing.T) {
	fixture := newAccountFixture(t, 50)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"a":"первая"}}`)
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":1,"data":{"a":"вторая"}}`)

	restored := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/restore", testPassword, `{"version":1}`)
	current := fixture.call(http.MethodGet, "/api/state", code, "")

	if restored.Code != http.StatusOK || !strings.Contains(restored.Body.String(), `"version":3`) {
		t.Fatalf("restored = %d %s", restored.Code, restored.Body)
	}
	if !strings.Contains(current.Body.String(), "первая") || !strings.Contains(current.Body.String(), `"version":3`) {
		t.Errorf("current = %s", current.Body)
	}
	events, _ := fixture.store.ListEvents(context.Background(), master.ID, 0)
	if len(events) == 0 || events[0].Kind != "admin.restore" {
		t.Errorf("the restore must be journaled, events = %+v", events)
	}
	for name, body := range map[string]string{"missing version": `{"version":99}`, "bad json": `nope`, "zero": `{"version":0}`} {
		want := http.StatusBadRequest
		if name == "missing version" {
			want = http.StatusNotFound
		}
		if got := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/restore", testPassword, body).Code; got != want {
			t.Errorf("%s: status = %d, want %d", name, got, want)
		}
	}
}

func TestAdminDeletesAMasterWithAllHerData(t *testing.T) {
	fixture := newAccountFixture(t, 50)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"a":1}}`)

	deleted := fixture.call(http.MethodDelete, "/api/admin/masters/"+master.ID, testPassword, "")

	if deleted.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", deleted.Code, deleted.Body)
	}
	if got := fixture.call(http.MethodGet, "/api/me", code, "").Code; got != http.StatusUnauthorized {
		t.Errorf("the deleted master must be signed out, status = %d", got)
	}
	if got := fixture.call(http.MethodDelete, "/api/admin/masters/"+master.ID, testPassword, "").Code; got != http.StatusNotFound {
		t.Errorf("second delete: status = %d", got)
	}
	if got := fixture.call(http.MethodDelete, "/api/admin/masters/x", code, "").Code; got == http.StatusOK {
		t.Error("a master must not delete anything")
	}
}
