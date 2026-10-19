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
	"time"

	"post-helper/server/internal/refs"
)

var (
	pngBytes = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'I', 'H', 'D', 'R'}
	mp4Bytes = []byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0, 'm', 'p', '4', '2', 'i', 's', 'o', 'm'}
)

type fakePlanner struct {
	plan    refs.Plan
	err     error
	request refs.Request
}

func (f *fakePlanner) Generate(_ context.Context, request refs.Request) (refs.Plan, error) {
	f.request = request
	return f.plan, f.err
}

type refsFixture struct {
	*accountFixture
	planner *fakePlanner
}

func newRefsFixture(t *testing.T) *refsFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	planner := &fakePlanner{plan: refs.Plan{Prompts: []refs.Prompt{
		{Prompt: "hands with gel polish, close up", Caption: "Руки крупно"},
		{Prompt: "polish bottles on a table", Caption: "Флаконы на столе"},
		{Prompt: "client choosing a colour", Caption: "Клиентка выбирает цвет"},
	}}}
	base.handler = NewHandler(Options{
		Responder:      base.responder,
		Reviewer:       base.reviewer,
		Accounts:       base.store,
		Refs:           refs.NewMemory(),
		RefPlanner:     planner,
		AgentToken:     agentToken,
		DailyAILimit:   50,
		RetentionDays:  1095,
		Password:       testPassword,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &refsFixture{accountFixture: base, planner: planner}
}

const planBody = `{"items":[
	{"key":"w1-mon","format":"reels","pillar":"Процесс","idea":"Видео снятия гель-лака"},
	{"key":"w1-wed","format":"post","pillar":"До и после","idea":"Кадр рук до и после"}
]}`

func (f *refsFixture) upload(id, token string, files [][]byte, captions string) *httptest.ResponseRecorder {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if captions != "" {
		_ = writer.WriteField(FieldData, captions)
	}
	for index, data := range files {
		part, _ := writer.CreateFormFile(FieldFiles, "ref"+string(rune('0'+index)))
		_, _ = part.Write(data)
	}
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/agent/refs/"+id+"/result", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func (f *refsFixture) statuses(t *testing.T, code string) []refs.Status {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/refs/status", code, "")
	var statuses []refs.Status
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &statuses) != nil {
		t.Fatalf("status = %d %s", recorder.Code, recorder.Body)
	}
	return statuses
}

func (f *refsFixture) claim(t *testing.T) RefAgentItem {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/agent/refs/next", agentToken, "")
	var item RefAgentItem
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &item) != nil {
		t.Fatalf("claim = %d %s", recorder.Code, recorder.Body)
	}
	return item
}

func TestMasterOrdersReferencesForThePlan(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")

	order := fixture.call(http.MethodPost, "/api/refs/order", code, planBody)
	statuses := fixture.statuses(t, code)

	if order.Code != http.StatusOK || !strings.Contains(order.Body.String(), `"added":2`) {
		t.Fatalf("order = %d %s", order.Code, order.Body)
	}
	if len(statuses) != 2 || statuses[0].Key != "w1-mon" || statuses[0].Status != refs.StatusQueued || statuses[0].Kind != refs.KindVideo || statuses[1].Kind != refs.KindPhoto {
		t.Errorf("statuses = %+v", statuses)
	}
}

func TestReorderingDropsItemsThatLeftThePlan(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, planBody)

	order := fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"w1-wed","format":"post","pillar":"До и после","idea":"Кадр рук до и после"}]}`)
	statuses := fixture.statuses(t, code)

	if !strings.Contains(order.Body.String(), `"removed":1`) || !strings.Contains(order.Body.String(), `"added":0`) {
		t.Errorf("order = %s", order.Body)
	}
	if len(statuses) != 1 || statuses[0].Key != "w1-wed" {
		t.Errorf("statuses = %+v", statuses)
	}
}

func TestOrderOfReferencesIsValidated(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	many := `{"items":[` + strings.Repeat(`{"key":"k","format":"post"},`, 120) + `{"key":"z","format":"post"}]}`
	tests := []struct {
		name, token, body string
		want              int
	}{
		{"unknown format", code, `{"items":[{"key":"a","format":"podcast"}]}`, http.StatusBadRequest},
		{"empty key", code, `{"items":[{"key":" ","format":"post"}]}`, http.StatusBadRequest},
		{"bad json", code, `nope`, http.StatusBadRequest},
		{"too many", code, many, http.StatusBadRequest},
		{"no login", "", planBody, http.StatusUnauthorized},
		{"owner is not a master", testPassword, planBody, http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := fixture.call(http.MethodPost, "/api/refs/order", test.token, test.body).Code; got != test.want {
				t.Errorf("status = %d, want %d", got, test.want)
			}
		})
	}
}

func TestAgentRoutesNeedTheToken(t *testing.T) {
	fixture := newRefsFixture(t)

	for _, token := range []string{"", "wrong-token-0123456789abcdef"} {
		if got := fixture.call(http.MethodGet, "/api/agent/refs/next", token, "").Code; got != http.StatusUnauthorized {
			t.Errorf("token %q: status = %d", token, got)
		}
	}
	if got := fixture.call(http.MethodGet, "/api/agent/refs/next", agentToken, "").Code; got != http.StatusNoContent {
		t.Errorf("empty queue: status = %d", got)
	}
}

func TestAgentGetsPromptsMadeFromTheMastersProfileAndDeliversFiles(t *testing.T) {
	fixture := newRefsFixture(t)
	code, master := fixture.master(t, "Анна")
	_, _ = fixture.store.SaveState(context.Background(), master.ID, 0, json.RawMessage(`{"onboarding":{"answers":{"name":"Анна","specialty":"маникюр","city":"Иркутск"}}}`), time.Now())
	fixture.call(http.MethodPost, "/api/refs/order", code, planBody)

	item := fixture.claim(t)
	upload := fixture.upload(item.ID, agentToken, [][]byte{mp4Bytes, mp4Bytes, mp4Bytes}, `["Руки крупно","Флаконы","Выбор цвета"]`)
	statuses := fixture.statuses(t, code)

	if item.Key != "w1-mon" || item.Kind != refs.KindVideo || len(item.Prompts) != 3 {
		t.Fatalf("item = %+v", item)
	}
	if fixture.planner.request.Profile.Specialty != "маникюр" || fixture.planner.request.Item.Idea != "Видео снятия гель-лака" {
		t.Errorf("planner got %+v", fixture.planner.request)
	}
	if upload.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", upload.Code, upload.Body)
	}
	done := statuses[0]
	if done.Status != refs.StatusDone || len(done.Files) != 3 || done.Files[0].MediaType != "video/mp4" || done.Files[1].Caption != "Флаконы" {
		t.Errorf("status = %+v", done)
	}

	file := fixture.call(http.MethodGet, "/api/refs/files/"+done.Files[0].ID, code, "")
	if file.Code != http.StatusOK || file.Header().Get("Content-Type") != "video/mp4" || !bytes.Equal(file.Body.Bytes(), mp4Bytes) {
		t.Errorf("file = %d %s", file.Code, file.Header().Get("Content-Type"))
	}
}

func TestAnotherMasterCannotOpenTheFiles(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	other, _ := fixture.master(t, "Вера")
	fixture.call(http.MethodPost, "/api/refs/order", code, planBody)
	item := fixture.claim(t)
	if up := fixture.upload(item.ID, agentToken, [][]byte{pngBytes}, ""); up.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", up.Code, up.Body)
	}
	fileID := fixture.statuses(t, code)[0].Files[0].ID

	if got := fixture.call(http.MethodGet, "/api/refs/files/"+fileID, other, "").Code; got != http.StatusNotFound {
		t.Errorf("another master: status = %d", got)
	}
	if len(fixture.statuses(t, other)) != 0 {
		t.Error("another master must not see the items")
	}
}

func TestUploadRejections(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, planBody)
	item := fixture.claim(t)
	tests := []struct {
		name  string
		token string
		files [][]byte
		want  int
	}{
		{"no token", "", [][]byte{pngBytes}, http.StatusUnauthorized},
		{"no files", agentToken, nil, http.StatusBadRequest},
		{"four files", agentToken, [][]byte{pngBytes, pngBytes, pngBytes, pngBytes}, http.StatusBadRequest},
		{"not a picture", agentToken, [][]byte{[]byte("hello, this is text")}, http.StatusUnsupportedMediaType},
		{"unknown item", agentToken, [][]byte{pngBytes}, http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			id := item.ID
			if test.name == "unknown item" {
				id = "missing"
			}
			if got := fixture.upload(id, test.token, test.files, "").Code; got != test.want {
				t.Errorf("status = %d, want %d", got, test.want)
			}
		})
	}
}

func TestAFailedReferenceGoesBackToTheQueueUntilTheLimit(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"a","format":"post","idea":"x"}]}`)

	first := fixture.claim(t)
	fail := fixture.call(http.MethodPost, "/api/agent/refs/"+first.ID+"/fail", agentToken, `{"reason":"нет видеокарты"}`)
	again := fixture.claim(t)
	final := fixture.call(http.MethodPost, "/api/agent/refs/"+again.ID+"/fail", agentToken, `{"reason":"сломалось","final":true}`)
	statuses := fixture.statuses(t, code)

	if fail.Code != http.StatusOK || again.ID != first.ID {
		t.Errorf("fail = %d, the same item must come back", fail.Code)
	}
	if final.Code != http.StatusOK || statuses[0].Status != refs.StatusFailed || statuses[0].Error != "сломалось" {
		t.Errorf("statuses = %+v", statuses)
	}
	if got := fixture.call(http.MethodGet, "/api/agent/refs/next", agentToken, "").Code; got != http.StatusNoContent {
		t.Errorf("a failed item must not come back, status = %d", got)
	}
}

func TestWhenThePlannerFailsTheItemWaitsForAnotherTry(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"a","format":"post","idea":"x"}]}`)
	fixture.planner.err = errors.New("claude is down")

	down := fixture.call(http.MethodGet, "/api/agent/refs/next", agentToken, "")
	fixture.planner.err = nil
	back := fixture.claim(t)

	if down.Code != http.StatusBadGateway {
		t.Errorf("status = %d", down.Code)
	}
	if back.Key != "a" {
		t.Errorf("the item must be back in the queue, got %+v", back)
	}
}

func TestChangedIdeaStartsTheReferencesAgain(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"a","format":"post","idea":"старая"}]}`)
	item := fixture.claim(t)
	fixture.upload(item.ID, agentToken, [][]byte{pngBytes}, "")

	order := fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"a","format":"post","idea":"новая"}]}`)
	statuses := fixture.statuses(t, code)

	if !strings.Contains(order.Body.String(), `"added":1`) {
		t.Errorf("order = %s", order.Body)
	}
	if statuses[0].Status != refs.StatusQueued || len(statuses[0].Files) != 0 {
		t.Errorf("statuses = %+v", statuses)
	}
}

func dated(key string, days int) string {
	date := time.Now().AddDate(0, 0, days).Format(refs.DateLayout)
	return `{"key":"` + key + `","format":"post","idea":"x","date":"` + date + `"}`
}

func TestConfirmingTheContentRemovesTheReferences(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("a", 1)+`]}`)
	item := fixture.claim(t)
	fixture.upload(item.ID, agentToken, [][]byte{pngBytes, pngBytes, pngBytes}, "")
	fileID := fixture.statuses(t, code)[0].Files[0].ID

	made := fixture.call(http.MethodPost, "/api/refs/made", code, `{"key":"a"}`)
	statuses := fixture.statuses(t, code)
	file := fixture.call(http.MethodGet, "/api/refs/files/"+fileID, code, "")
	again := fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("a", 1)+`]}`)

	if made.Code != http.StatusOK || statuses[0].Status != refs.StatusMade || len(statuses[0].Files) != 0 {
		t.Errorf("made = %d, statuses = %+v", made.Code, statuses)
	}
	if file.Code != http.StatusNotFound {
		t.Errorf("the file must be gone, status = %d", file.Code)
	}
	if !strings.Contains(again.Body.String(), `"added":0`) || fixture.statuses(t, code)[0].Status != refs.StatusMade {
		t.Errorf("a confirmed item must not be generated again, order = %s", again.Body)
	}
	if got := fixture.call(http.MethodGet, "/api/agent/refs/next", agentToken, "").Code; got != http.StatusNoContent {
		t.Errorf("nothing to make, status = %d", got)
	}
}

func TestConfirmRejections(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	other, _ := fixture.master(t, "Вера")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("a", 1)+`]}`)
	fixture.claim(t)

	tests := []struct {
		name, token, body string
		want              int
	}{
		{"being made right now", code, `{"key":"a"}`, http.StatusConflict},
		{"unknown key", code, `{"key":"zzz"}`, http.StatusNotFound},
		{"another masters item", other, `{"key":"a"}`, http.StatusNotFound},
		{"empty key", code, `{"key":" "}`, http.StatusBadRequest},
		{"no login", "", `{"key":"a"}`, http.StatusUnauthorized},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := fixture.call(http.MethodPost, "/api/refs/made", test.token, test.body).Code; got != test.want {
				t.Errorf("status = %d, want %d", got, test.want)
			}
		})
	}
}

func TestOldUnconfirmedReferencesStopNewOnesUntilTheyAreClosed(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("old", -10)+`]}`)
	old := fixture.claim(t)
	fixture.upload(old.ID, agentToken, [][]byte{pngBytes}, "")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("old", -10)+`,`+dated("new", 3)+`]}`)

	blocked := fixture.call(http.MethodGet, "/api/agent/refs/next", agentToken, "")
	statuses := fixture.statuses(t, code)
	fixture.call(http.MethodPost, "/api/refs/made", code, `{"key":"old"}`)
	freed := fixture.claim(t)

	if blocked.Code != http.StatusNoContent {
		t.Errorf("new references must wait, status = %d", blocked.Code)
	}
	if !statuses[1].Stale || statuses[0].Stale {
		t.Errorf("only the old finished item is overdue, statuses = %+v", statuses)
	}
	if freed.Key != "new" {
		t.Errorf("after the confirmation the new item is made, got %+v", freed)
	}
}

func TestRecentOrUndatedReferencesDoNotBlockAnything(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[`+dated("recent", -1)+`,{"key":"free","format":"post","idea":"x"}]}`)
	first := fixture.claim(t)
	fixture.upload(first.ID, agentToken, [][]byte{pngBytes}, "")

	second := fixture.claim(t)

	if second.Key == first.Key {
		t.Errorf("the second item must be made too, got %+v", second)
	}
}

func TestTheDateOfAnItemMustBeADate(t *testing.T) {
	fixture := newRefsFixture(t)
	code, _ := fixture.master(t, "Анна")

	got := fixture.call(http.MethodPost, "/api/refs/order", code, `{"items":[{"key":"a","format":"post","date":"завтра"}]}`).Code

	if got != http.StatusBadRequest {
		t.Errorf("status = %d", got)
	}
}
