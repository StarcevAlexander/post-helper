package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/review"
)

type fakeReviewer struct {
	result   review.Review
	err      error
	requests []review.Request
}

func (f *fakeReviewer) Generate(_ context.Context, request review.Request) (review.Review, error) {
	f.requests = append(f.requests, request)
	return f.result, f.err
}

type accountFixture struct {
	handler   http.Handler
	store     *accounts.Memory
	reviewer  *fakeReviewer
	responder *fakeResponder
}

func newAccountFixture(t *testing.T, dailyLimit int) *accountFixture {
	t.Helper()
	fixture := &accountFixture{
		store:     accounts.NewMemory(),
		reviewer:  &fakeReviewer{result: review.Review{Headline: "Итог", WhatToChange: []string{"x"}}},
		responder: &fakeResponder{reply: "ответ"},
	}
	fixture.handler = NewHandler(Options{
		Responder:      fixture.responder,
		Reviewer:       fixture.reviewer,
		Accounts:       fixture.store,
		DailyAILimit:   dailyLimit,
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

func (f *accountFixture) chat(token string) *httptest.ResponseRecorder {
	return f.call(http.MethodPost, "/api/chat", token, "")
}

func TestMe(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	admin := fixture.call(http.MethodGet, "/api/me", testPassword, "")
	master := fixture.call(http.MethodGet, "/api/me", code, "")

	if !strings.Contains(admin.Body.String(), `"role":"admin"`) {
		t.Errorf("admin = %s", admin.Body)
	}
	for _, want := range []string{`"role":"master"`, `"name":"Анна"`, `"dailyLimit":5`, `"usageToday":0`} {
		if !strings.Contains(master.Body.String(), want) {
			t.Errorf("master %s lacks %s", master.Body, want)
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

func TestQuotaLimitsMastersButNotTheOwner(t *testing.T) {
	fixture := newAccountFixture(t, 2)
	code, master := fixture.master(t, "Анна")

	statuses := []int{}
	for i := 0; i < 3; i++ {
		statuses = append(statuses, fixture.chat(code).Code)
	}

	if statuses[0] != http.StatusBadRequest || statuses[1] != http.StatusBadRequest || statuses[2] != http.StatusTooManyRequests {
		t.Errorf("statuses = %v", statuses)
	}
	for i := 0; i < 5; i++ {
		if got := fixture.chat(testPassword).Code; got == http.StatusTooManyRequests {
			t.Fatal("the owner must not be limited")
		}
	}
	used, _ := fixture.store.CountUsage(context.Background(), master.ID, dayStart(time.Now()))
	if used != 2 {
		t.Errorf("used = %d", used)
	}
}

func TestQuotaIsPerMasterAndCanBeSwitchedOff(t *testing.T) {
	limited := newAccountFixture(t, 1)
	first, _ := limited.master(t, "Анна")
	second, _ := limited.master(t, "Вера")
	limited.chat(first)
	if limited.chat(first).Code != http.StatusTooManyRequests {
		t.Error("the first master must be limited")
	}
	if limited.chat(second).Code == http.StatusTooManyRequests {
		t.Error("the second master has her own allowance")
	}

	unlimited := newAccountFixture(t, 0)
	code, _ := unlimited.master(t, "Анна")
	for i := 0; i < 4; i++ {
		if unlimited.chat(code).Code == http.StatusTooManyRequests {
			t.Fatal("a zero limit means no limit")
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

const reviewBody = `{"profile":{"specialty":" маникюр "},"positioning":"Аккуратный","cadence":{"reels":1,"posts":1,"stories":3},"pillars":[{"title":"Окошки","ideas":["Свободно в пятницу"]}],"items":[{"format":"reels","pillar":"Окошки","idea":"Видео","done":true},{"format":"post","pillar":"Окошки","idea":"Пост","done":false}],"results":{"inquiries":4,"bestIdea":"Видео","hard":"нет времени"}}`

func TestReview(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	recorder := fixture.call(http.MethodPost, "/api/review", code, reviewBody)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"headline":"Итог"`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	got := fixture.reviewer.requests[0]
	if got.Profile.Specialty != "маникюр" || len(got.Items) != 2 || got.Results.Inquiries == nil || *got.Results.Inquiries != 4 {
		t.Errorf("request = %+v", got)
	}
}

func TestReviewIgnoresAbsurdInquiryCounts(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	code, _ := fixture.master(t, "Анна")

	fixture.call(http.MethodPost, "/api/review", code, strings.Replace(reviewBody, `"inquiries":4`, `"inquiries":99999999`, 1))

	if fixture.reviewer.requests[0].Results.Inquiries != nil {
		t.Error("an absurd number must be dropped")
	}
}

func TestReviewRejections(t *testing.T) {
	fixture := newAccountFixture(t, 50)
	code, _ := fixture.master(t, "Анна")
	items := strings.Repeat(`{"format":"post","pillar":"а","idea":"б","done":true},`, MaxReviewItems+1)
	long := strings.Repeat("я", MaxReviewFieldRunes+1)
	tests := []struct {
		name string
		body string
		want int
	}{
		{"bad json", `nope`, http.StatusBadRequest},
		{"no specialty", `{"profile":{"specialty":" "},"items":[{"format":"post","idea":"x"}]}`, http.StatusBadRequest},
		{"no items", `{"profile":{"specialty":"x"},"items":[]}`, http.StatusBadRequest},
		{"too many items", `{"profile":{"specialty":"x"},"items":[` + strings.TrimSuffix(items, ",") + `]}`, http.StatusBadRequest},
		{"long field", `{"profile":{"specialty":"x"},"items":[{"format":"post","idea":"` + long + `"}]}`, http.StatusBadRequest},
		{"long answer", `{"profile":{"specialty":"x"},"items":[{"format":"post","idea":"x"}],"results":{"hard":"` + long + `"}}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := fixture.call(http.MethodPost, "/api/review", code, tt.body).Code; got != tt.want {
				t.Errorf("status = %d, want %d", got, tt.want)
			}
		})
	}

	fixture.reviewer.err = review.ErrRefused
	if got := fixture.call(http.MethodPost, "/api/review", code, reviewBody).Code; got != http.StatusUnprocessableEntity {
		t.Errorf("refused: status = %d", got)
	}
	fixture.reviewer.err = errors.New("boom")
	if got := fixture.call(http.MethodPost, "/api/review", code, reviewBody).Code; got != http.StatusBadGateway {
		t.Errorf("fails: status = %d", got)
	}
}

func TestReviewNeedsALogin(t *testing.T) {
	fixture := newAccountFixture(t, 5)

	if got := fixture.call(http.MethodPost, "/api/review", "", reviewBody).Code; got != http.StatusUnauthorized {
		t.Errorf("status = %d", got)
	}
}
