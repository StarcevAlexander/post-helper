package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
)

const agentToken = "agent-token-0123456789abcdef"

type jobsFixture struct {
	*accountFixture
	auditor *fakeAuditor
}

func newJobsFixture(t *testing.T, withAgent bool) *jobsFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	auditor := &fakeAuditor{result: audit.Result{Summary: "Профиль аккуратный", Fixes: []string{"Добавьте ссылку"}}}
	token := ""
	if withAgent {
		token = agentToken
	}
	base.handler = NewHandler(Options{
		Auditor:        auditor,
		Accounts:       base.store,
		AgentToken:     token,
		DailyAILimit:   50,
		RetentionDays:  1095,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &jobsFixture{accountFixture: base, auditor: auditor}
}

func (f *jobsFixture) upload(id, token, data string, files []auditFile) *httptest.ResponseRecorder {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if data != "" {
		_ = writer.WriteField(FieldData, data)
	}
	for _, file := range files {
		part, _ := writer.CreateFormFile(FieldImages, file.name)
		_, _ = part.Write(file.data)
	}
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/agent/jobs/"+id+"/result", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func (f *jobsFixture) order(t *testing.T, code string) accounts.AuditJob {
	t.Helper()
	recorder := f.call(http.MethodPost, "/api/audit/jobs", code, `{"handle":"https://www.instagram.com/Anna_Nails/","consent":true}`)
	var job accounts.AuditJob
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &job) != nil {
		t.Fatalf("order = %d %s", recorder.Code, recorder.Body)
	}
	return job
}

func (f *jobsFixture) claim(t *testing.T) AgentJob {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "")
	var job AgentJob
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &job) != nil {
		t.Fatalf("claim = %d %s", recorder.Code, recorder.Body)
	}
	return job
}

const collectedJSON = `{"handle":"anna_nails","name":"Анна | Маникюр","bio":"Маникюр в Иркутске","followers":1250,"posts":[{"type":"reel","caption":"Нюд на неделю","likes":120}]}`

func TestMasterOrdersAnAuditOfHerOpenAccount(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, master := fixture.master(t, "Анна")

	empty := fixture.call(http.MethodGet, "/api/audit/jobs/latest", code, "")
	job := fixture.order(t, code)
	latest := fixture.call(http.MethodGet, "/api/audit/jobs/latest", code, "")

	if empty.Code != http.StatusNoContent {
		t.Errorf("no job yet: status = %d", empty.Code)
	}
	if job.Handle != "anna_nails" || job.Status != accounts.JobQueued || job.MasterID != master.ID {
		t.Errorf("job = %+v", job)
	}
	if latest.Code != http.StatusOK || !strings.Contains(latest.Body.String(), `"status":"queued"`) {
		t.Errorf("latest = %d %s", latest.Code, latest.Body)
	}
	events, _ := fixture.store.ListEvents(context.Background(), master.ID, 0)
	if len(events) != 1 || events[0].Kind != "audit.job.created" {
		t.Errorf("the order must be journaled, events = %+v", events)
	}
}

func TestOrderRejections(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	tests := []struct {
		name  string
		token string
		body  string
		want  int
	}{
		{"no consent", code, `{"handle":"anna_nails","consent":false}`, http.StatusBadRequest},
		{"missing consent", code, `{"handle":"anna_nails"}`, http.StatusBadRequest},
		{"bad handle", code, `{"handle":"анна ногти","consent":true}`, http.StatusBadRequest},
		{"a post link", code, `{"handle":"https://instagram.com/p/Cxyz/","consent":true}`, http.StatusBadRequest},
		{"bad json", code, `nope`, http.StatusBadRequest},
		{"no login", "", `{"handle":"anna_nails","consent":true}`, http.StatusUnauthorized},
		{"the owner has no data to audit", testPassword, `{"handle":"anna_nails","consent":true}`, http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := fixture.call(http.MethodPost, "/api/audit/jobs", tt.token, tt.body).Code; got != tt.want {
				t.Errorf("status = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestSecondOrderIsRefusedWhileOneIsActiveAndCancelFreesIt(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	first := fixture.order(t, code)

	again := fixture.call(http.MethodPost, "/api/audit/jobs", code, `{"handle":"anna_nails","consent":true}`)
	cancelled := fixture.call(http.MethodPost, "/api/audit/jobs/"+first.ID+"/cancel", code, "")
	third := fixture.call(http.MethodPost, "/api/audit/jobs", code, `{"handle":"anna_nails","consent":true}`)

	if again.Code != http.StatusConflict || !strings.Contains(again.Body.String(), first.ID) {
		t.Errorf("again = %d %s", again.Code, again.Body)
	}
	if cancelled.Code != http.StatusOK || third.Code != http.StatusOK {
		t.Errorf("cancelled = %d, third = %d", cancelled.Code, third.Code)
	}
	if got := fixture.call(http.MethodPost, "/api/audit/jobs/"+first.ID+"/cancel", code, "").Code; got != http.StatusConflict {
		t.Errorf("cancelling a cancelled job: status = %d", got)
	}
	other, _ := fixture.master(t, "Вера")
	if got := fixture.call(http.MethodPost, "/api/audit/jobs/"+first.ID+"/cancel", other, "").Code; got != http.StatusNotFound {
		t.Errorf("someone else's job: status = %d", got)
	}
}

func TestAgentEndpointsDoNotExistWithoutAToken(t *testing.T) {
	fixture := newJobsFixture(t, false)

	if got := fixture.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "").Code; got != http.StatusNotFound {
		t.Errorf("status = %d, want 404", got)
	}
}

func TestAgentEndpointsAcceptOnlyTheAgentToken(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	job := fixture.order(t, code)

	for name, token := range map[string]string{"none": "", "wrong": "wrong-token", "owner password": testPassword, "master code": code} {
		if got := fixture.call(http.MethodGet, "/api/agent/jobs/next", token, "").Code; got != http.StatusUnauthorized {
			t.Errorf("next with %s: status = %d", name, got)
		}
		if got := fixture.call(http.MethodPost, "/api/agent/jobs/"+job.ID+"/fail", token, `{"reason":"x"}`).Code; got != http.StatusUnauthorized {
			t.Errorf("fail with %s: status = %d", name, got)
		}
		if got := fixture.upload(job.ID, token, collectedJSON, pngFiles(1)).Code; got != http.StatusUnauthorized {
			t.Errorf("result with %s: status = %d", name, got)
		}
	}
	if got := fixture.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "").Code; got != http.StatusOK {
		t.Errorf("the agent token must work, status = %d", got)
	}
}

func TestAgentClaimsTheOldestJobWithTheProfileOfTheMaster(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"onboarding":{"answers":{"specialty":"маникюр","city":"Иркутск","name":"Анна","audit":"старый разбор"}}}}`)
	none := fixture.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "")
	fixture.order(t, code)

	job := fixture.claim(t)
	second := fixture.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "")

	if none.Code != http.StatusNoContent || second.Code != http.StatusNoContent {
		t.Errorf("none = %d, second = %d", none.Code, second.Code)
	}
	if job.Handle != "anna_nails" || job.Attempts != 1 || job.Profile.Specialty != "маникюр" || job.Profile.City != "Иркутск" || job.Profile.Name != "Анна" {
		t.Errorf("job = %+v", job)
	}
	if strings.Contains(fixture.call(http.MethodGet, "/api/agent/jobs/next", agentToken, "").Body.String(), "старый разбор") {
		t.Error("the previous audit must not travel to the agent")
	}
}

func TestAgentDeliversTheResultAndTheMasterGetsTheAudit(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPut, "/api/state", code, `{"baseVersion":0,"data":{"onboarding":{"answers":{"specialty":"маникюр","city":"Иркутск"}}}}`)
	fixture.order(t, code)
	job := fixture.claim(t)

	recorder := fixture.upload(job.ID, agentToken, collectedJSON, pngFiles(3))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	request := fixture.auditor.requests[0]
	if request.Profile.Specialty != "маникюр" || len(request.Images) != 3 {
		t.Errorf("request = %+v", request)
	}
	for _, want := range []string{"@anna_nails", "Подписчиков: 1250", "Нюд на неделю", "Лайков: 120"} {
		if !strings.Contains(request.Extra, want) {
			t.Errorf("the collected data lacks %q: %s", want, request.Extra)
		}
	}

	latest := fixture.call(http.MethodGet, "/api/audit/jobs/latest", code, "")
	if !strings.Contains(latest.Body.String(), `"status":"done"`) || !strings.Contains(latest.Body.String(), "Профиль аккуратный") {
		t.Errorf("latest = %s", latest.Body)
	}
	events, _ := fixture.store.ListEvents(context.Background(), master.ID, 0)
	if len(events) != 2 || events[0].Kind != "audit" || !strings.Contains(string(events[0].Payload), `"source":"agent"`) {
		t.Errorf("events = %+v", events)
	}
	used, _ := fixture.store.CountUsage(context.Background(), master.ID, master.CreatedAt)
	if used != 1 {
		t.Errorf("the agent's audit must count as a use of the AI, used = %d", used)
	}
}

func TestResultRejections(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	job := fixture.order(t, code)

	if got := fixture.upload(job.ID, agentToken, collectedJSON, pngFiles(1)).Code; got != http.StatusConflict {
		t.Errorf("a job nobody has claimed: status = %d, want 409", got)
	}
	claimed := fixture.claim(t)
	for name, tc := range map[string]struct {
		data  string
		files []auditFile
		want  int
	}{
		"bad data":    {"{", pngFiles(1), http.StatusBadRequest},
		"no data":     {"", pngFiles(1), http.StatusBadRequest},
		"no images":   {collectedJSON, nil, http.StatusBadRequest},
		"too many":    {collectedJSON, pngFiles(audit.MaxAgentImages + 1), http.StatusBadRequest},
		"not a image": {collectedJSON, []auditFile{{name: "a.txt", data: []byte("текст")}}, http.StatusUnsupportedMediaType},
	} {
		if got := fixture.upload(claimed.ID, agentToken, tc.data, tc.files).Code; got != tc.want {
			t.Errorf("%s: status = %d, want %d", name, got, tc.want)
		}
	}
	if got := fixture.upload("missing", agentToken, collectedJSON, pngFiles(1)).Code; got != http.StatusNotFound {
		t.Errorf("unknown job: status = %d", got)
	}
}

func TestAnAuditThatFailsPutsTheJobBackOrClosesIt(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	job := fixture.order(t, code)
	claimed := fixture.claim(t)

	fixture.auditor.err = &audit.UnreadableError{Reason: "слишком тёмные"}
	unreadable := fixture.upload(claimed.ID, agentToken, collectedJSON, pngFiles(1))
	again, _ := fixture.store.AuditJob(context.Background(), job.ID)
	if unreadable.Code != http.StatusUnprocessableEntity || again.Status != accounts.JobQueued || !strings.Contains(again.Error, "слишком тёмные") {
		t.Errorf("unreadable = %d, job = %+v", unreadable.Code, again)
	}

	fixture.claim(t)
	fixture.auditor.err = audit.ErrRefused
	refused := fixture.upload(claimed.ID, agentToken, collectedJSON, pngFiles(1))
	closed, _ := fixture.store.AuditJob(context.Background(), job.ID)
	if refused.Code != http.StatusUnprocessableEntity || closed.Status != accounts.JobFailed {
		t.Errorf("refused = %d, job = %+v", refused.Code, closed)
	}

	second := fixture.order(t, code)
	fixture.claim(t)
	fixture.auditor.err = errors.New("boom")
	failed := fixture.upload(second.ID, agentToken, collectedJSON, pngFiles(1))
	retry, _ := fixture.store.AuditJob(context.Background(), second.ID)
	if failed.Code != http.StatusBadGateway || retry.Status != accounts.JobQueued {
		t.Errorf("failed = %d, job = %+v", failed.Code, retry)
	}
}

func TestAgentReportsAFailure(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, master := fixture.master(t, "Анна")
	job := fixture.order(t, code)
	fixture.claim(t)

	soft := fixture.call(http.MethodPost, "/api/agent/jobs/"+job.ID+"/fail", agentToken, `{"reason":"Instagram просит войти"}`)
	queued, _ := fixture.store.AuditJob(context.Background(), job.ID)
	fixture.claim(t)
	final := fixture.call(http.MethodPost, "/api/agent/jobs/"+job.ID+"/fail", agentToken, `{"reason":"Профиль закрытый","final":true}`)
	closed, _ := fixture.store.AuditJob(context.Background(), job.ID)

	if soft.Code != http.StatusOK || queued.Status != accounts.JobQueued {
		t.Errorf("soft = %d, job = %+v", soft.Code, queued)
	}
	if final.Code != http.StatusOK || closed.Status != accounts.JobFailed || closed.Error != "Профиль закрытый" {
		t.Errorf("final = %d, job = %+v", final.Code, closed)
	}
	latest := fixture.call(http.MethodGet, "/api/audit/jobs/latest", code, "")
	if !strings.Contains(latest.Body.String(), "Профиль закрытый") {
		t.Errorf("the master must see the reason, got %s", latest.Body)
	}
	events, _ := fixture.store.ListEvents(context.Background(), master.ID, 0)
	if events[0].Kind != "audit.job.failed" {
		t.Errorf("events = %+v", events)
	}
	if got := fixture.call(http.MethodPost, "/api/agent/jobs/"+job.ID+"/fail", agentToken, `{"reason":"x"}`).Code; got != http.StatusConflict {
		t.Errorf("failing a finished job: status = %d", got)
	}
	if got := fixture.call(http.MethodPost, "/api/agent/jobs/missing/fail", agentToken, `{"reason":"x"}`).Code; got != http.StatusNotFound {
		t.Errorf("unknown job: status = %d", got)
	}
	if got := fixture.call(http.MethodPost, "/api/agent/jobs/"+job.ID+"/fail", agentToken, `nope`).Code; got != http.StatusBadRequest {
		t.Errorf("bad json: status = %d", got)
	}
}

func TestOwnerSeesTheQueueWithoutTheResults(t *testing.T) {
	fixture := newJobsFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	job := fixture.order(t, code)
	fixture.claim(t)
	fixture.upload(job.ID, agentToken, collectedJSON, pngFiles(1))

	list := fixture.call(http.MethodGet, "/api/admin/audit-jobs", testPassword, "")

	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"masterName":"Анна"`) || !strings.Contains(list.Body.String(), `"status":"done"`) {
		t.Errorf("list = %d %s", list.Code, list.Body)
	}
	if strings.Contains(list.Body.String(), "Профиль аккуратный") {
		t.Errorf("the list must not carry the audits, got %s", list.Body)
	}
	if got := fixture.call(http.MethodGet, "/api/admin/audit-jobs", code, "").Code; got != http.StatusForbidden {
		t.Errorf("a master must not see the queue, status = %d", got)
	}
}
