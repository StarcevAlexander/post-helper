package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"post-helper/server/internal/notices"
	"post-helper/server/internal/push"
)

const noticePlanState = `{"calendar":{"startedOn":"2026-10-26","schedule":{"slots":[],"publishTime":"19:00"},"items":[
	{"id":"a","date":"2026-10-27","time":"19:00","format":"reels","pillar":"x","idea":"y"},
	{"id":"c","date":"2026-10-28","time":"19:00","format":"post","pillar":"x","idea":"z","done":true}]}}`

type noticesFixture struct {
	*accountFixture
	notices *notices.Memory
	pusher  *fakePusher
}

func newNoticesFixture(t *testing.T) *noticesFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	fixture := &noticesFixture{accountFixture: base, notices: notices.NewMemory(), pusher: newFakePusher(1)}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	base.handler = bothHandlers(Options{
		Accounts:       base.store,
		Notices:        fixture.notices,
		Pusher:         &notices.Recorder{Sender: fixture.pusher, Store: fixture.notices, Logger: logger},
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         logger,
	})
	return fixture
}

func (f *noticesFixture) add(t *testing.T, masterID, id string, at time.Time, topic push.Topic) {
	t.Helper()
	entry := notices.Entry{ID: id, MasterID: masterID, Title: "t-" + id, Body: "b-" + id, URL: "./", Topic: topic, Delivered: 1, SentAt: at}
	if err := f.notices.Add(context.Background(), entry); err != nil {
		t.Fatal(err)
	}
}

func (f *noticesFixture) list(t *testing.T, token string) []NoticeView {
	t.Helper()
	response := f.call(http.MethodGet, "/api/notifications", token, "")
	if response.Code != http.StatusOK {
		t.Fatalf("list = %d %s", response.Code, response.Body)
	}
	var views []NoticeView
	if err := json.Unmarshal(response.Body.Bytes(), &views); err != nil {
		t.Fatal(err)
	}
	return views
}

func TestNotificationHistoryJudgesEveryEntryAgainstTheCurrentPlan(t *testing.T) {
	fixture := newNoticesFixture(t)
	code, master := fixture.master(t, "Анна")
	if _, err := fixture.store.SaveState(context.Background(), master.ID, 0, json.RawMessage(noticePlanState), time.Now()); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
	fixture.add(t, master.ID, "old", base, push.Topic{Kind: push.KindPlan, PlanStart: "2026-09-01"})
	fixture.add(t, master.ID, "wait", base.Add(time.Hour), push.Topic{Kind: push.KindPublication, PlanStart: "2026-10-26", ItemID: "a", Date: "2026-10-27"})
	fixture.add(t, master.ID, "done", base.Add(2*time.Hour), push.Topic{Kind: push.KindPublication, PlanStart: "2026-10-26", ItemID: "c", Date: "2026-10-28"})

	views := fixture.list(t, code)

	if len(views) != 3 {
		t.Fatalf("views = %+v", views)
	}
	want := []NoticeView{
		{ID: "done", Kind: push.KindPublication, Title: "t-done", Body: "b-done", SentAt: base.Add(2 * time.Hour), State: notices.StateDone, Reason: notices.ReasonPublished},
		{ID: "wait", Kind: push.KindPublication, Title: "t-wait", Body: "b-wait", SentAt: base.Add(time.Hour), State: notices.StateActual, Link: "/kit/a"},
		{ID: "old", Kind: push.KindPlan, Title: "t-old", Body: "b-old", SentAt: base, State: notices.StateOutdated, Reason: notices.ReasonPlanReplaced},
	}
	for index := range want {
		if views[index] != want[index] {
			t.Errorf("view %d = %+v, want %+v", index, views[index], want[index])
		}
	}
}

func TestOpeningAnEntryChecksItAgainAfterThePlanChanged(t *testing.T) {
	fixture := newNoticesFixture(t)
	code, master := fixture.master(t, "Анна")
	saved, err := fixture.store.SaveState(context.Background(), master.ID, 0, json.RawMessage(noticePlanState), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	fixture.add(t, master.ID, "wait", time.Now(), push.Topic{Kind: push.KindPublication, PlanStart: "2026-10-26", ItemID: "a", Date: "2026-10-27"})
	if views := fixture.list(t, code); views[0].State != notices.StateActual {
		t.Fatalf("before = %+v", views[0])
	}

	published := `{"calendar":{"startedOn":"2026-10-26","items":[{"id":"a","date":"2026-10-27","time":"19:00","done":true}]}}`
	if _, err := fixture.store.SaveState(context.Background(), master.ID, saved.Version, json.RawMessage(published), time.Now()); err != nil {
		t.Fatal(err)
	}
	response := fixture.call(http.MethodGet, "/api/notifications/wait", code, "")
	var view NoticeView
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &view) != nil {
		t.Fatalf("get = %d %s", response.Code, response.Body)
	}
	if view.State != notices.StateDone || view.Link != "" {
		t.Errorf("after = %+v", view)
	}
}

func TestNotificationHistoryIsPrivateToItsMaster(t *testing.T) {
	fixture := newNoticesFixture(t)
	_, owner := fixture.master(t, "Анна")
	stranger, _ := fixture.master(t, "Вера")
	fixture.add(t, owner.ID, "secret", time.Now(), push.Topic{Kind: push.KindMessage})

	if views := fixture.list(t, stranger); len(views) != 0 {
		t.Errorf("stranger sees %+v", views)
	}
	if response := fixture.call(http.MethodGet, "/api/notifications/secret", stranger, ""); response.Code != http.StatusNotFound {
		t.Errorf("stranger get = %d", response.Code)
	}
	if response := fixture.call(http.MethodGet, "/api/notifications", "", ""); response.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list = %d", response.Code)
	}
}

func TestADeliveredPushLandsInTheHistory(t *testing.T) {
	fixture := newNoticesFixture(t)
	code, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/push", testPassword, `{"title":"Привет","body":"Загляните в календарь","url":"./calendar"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("push = %d %s", response.Code, response.Body)
	}

	views := fixture.list(t, code)
	if len(views) != 1 || views[0].Title != "Привет" || views[0].Kind != push.KindMessage ||
		views[0].State != notices.StateActual || views[0].Link != "/calendar" {
		t.Fatalf("views = %+v", views)
	}
}
