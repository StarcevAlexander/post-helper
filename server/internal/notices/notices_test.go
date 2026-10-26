package notices

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"post-helper/server/internal/plan"
	"post-helper/server/internal/push"
)

func testPlan() plan.Calendar {
	return plan.Calendar{
		StartedOn: "2026-10-26",
		Schedule:  plan.Schedule{Slots: []plan.Slot{{Weekday: 2, Time: "11:00"}}},
		Items: []plan.Item{
			{ID: "a", Date: "2026-10-27", Time: "12:00"},
			{ID: "b", Date: "2026-10-30", Time: "12:00"},
			{ID: "c", Date: "2026-10-28", Time: "12:00", Done: true},
		},
	}
}

func TestJudge(t *testing.T) {
	facts := Facts{Plan: testPlan(), HasPlan: true, MediaDone: map[string]bool{"a": true, "b": true}, RefsReady: true, Today: "2026-10-27"}
	noPlan := Facts{Today: "2026-10-27"}
	noRefs := facts
	noRefs.RefsReady = false
	today := Facts{Plan: testPlan(), HasPlan: true, Today: "2026-10-28"}
	start := "2026-10-26"
	for name, test := range map[string]struct {
		topic push.Topic
		url   string
		facts Facts
		want  Verdict
	}{
		"plan of the current plan":         {topic: push.Topic{Kind: push.KindPlan, PlanStart: start}, facts: facts, want: Verdict{State: StateActual, Link: LinkCalendar}},
		"plan replaced by a newer plan":    {topic: push.Topic{Kind: push.KindPlan, PlanStart: "2026-09-01"}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonPlanReplaced}},
		"plan removed":                     {topic: push.Topic{Kind: push.KindPlan, PlanStart: start}, facts: noPlan, want: Verdict{State: StateOutdated, Reason: ReasonPlanRemoved}},
		"refs ready":                       {topic: push.Topic{Kind: push.KindRefs, PlanStart: start}, facts: facts, want: Verdict{State: StateActual, Link: LinkCalendar}},
		"refs cleared":                     {topic: push.Topic{Kind: push.KindRefs, PlanStart: start}, facts: noRefs, want: Verdict{State: StateOutdated, Reason: ReasonRefsGone}},
		"one ready content leads to it":    {topic: push.Topic{Kind: push.KindMedia, PlanStart: start, ItemIDs: []string{"a", "x"}}, facts: facts, want: Verdict{State: StateActual, Link: LinkContent + "a"}},
		"several ready contents lead home": {topic: push.Topic{Kind: push.KindMedia, PlanStart: start, ItemIDs: []string{"a", "b"}}, facts: facts, want: Verdict{State: StateActual, Link: LinkToday}},
		"content deleted":                  {topic: push.Topic{Kind: push.KindMedia, PlanStart: start, ItemIDs: []string{"x"}}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonMediaGone}},
		"content day ahead":                {topic: push.Topic{Kind: push.KindContentDay, PlanStart: start, Date: "2026-11-04", Time: "11:00"}, facts: facts, want: Verdict{State: StateActual, Link: LinkShoot + "1"}},
		"content day is today":             {topic: push.Topic{Kind: push.KindContentDay, PlanStart: start, Date: "2026-10-28", Time: "11:00"}, facts: today, want: Verdict{State: StateActual, Link: LinkShoot + "0"}},
		"content day passed":               {topic: push.Topic{Kind: push.KindContentDay, PlanStart: start, Date: "2026-10-26", Time: "11:00"}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonDayPassed}},
		"content day moved":                {topic: push.Topic{Kind: push.KindContentDay, PlanStart: start, Date: "2026-10-28", Time: "10:00"}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonScheduleChanged}},
		"publication waits":                {topic: push.Topic{Kind: push.KindPublication, PlanStart: start, ItemID: "a", Date: "2026-10-27"}, facts: facts, want: Verdict{State: StateActual, Link: LinkKit + "a"}},
		"publication moved":                {topic: push.Topic{Kind: push.KindPublication, PlanStart: start, ItemID: "b", Date: "2026-10-29"}, facts: facts, want: Verdict{State: StateActual, Link: LinkKit + "b", Reason: ReasonMoved, MovedTo: "2026-10-30"}},
		"publication done":                 {topic: push.Topic{Kind: push.KindPublication, PlanStart: start, ItemID: "c", Date: "2026-10-28"}, facts: facts, want: Verdict{State: StateDone, Reason: ReasonPublished}},
		"publication removed":              {topic: push.Topic{Kind: push.KindPublication, PlanStart: start, ItemID: "z", Date: "2026-10-28"}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonItemRemoved}},
		"publication of an older plan":     {topic: push.Topic{Kind: push.KindPublication, PlanStart: "2026-09-01", ItemID: "a", Date: "2026-10-27"}, facts: facts, want: Verdict{State: StateOutdated, Reason: ReasonPlanReplaced}},
		"message to the root":              {topic: push.Topic{Kind: push.KindMessage}, url: "./", facts: facts, want: Verdict{State: StateInfo}},
		"message to a screen":              {topic: push.Topic{Kind: push.KindMessage}, url: "./?screen=today", facts: facts, want: Verdict{State: StateActual, Link: "/today"}},
		"message to a path":                {topic: push.Topic{Kind: push.KindMessage}, url: "./calendar", facts: facts, want: Verdict{State: StateActual, Link: "/calendar"}},
		"message with a query":             {topic: push.Topic{Kind: push.KindMessage}, url: "./calendar?x=1", facts: facts, want: Verdict{State: StateInfo}},
		"unknown kind":                     {topic: push.Topic{}, facts: facts, want: Verdict{State: StateInfo}},
	} {
		t.Run(name, func(t *testing.T) {
			if got := Judge(Entry{Topic: test.topic, URL: test.url}, test.facts); got != test.want {
				t.Fatalf("Judge = %+v, want %+v", got, test.want)
			}
		})
	}
}

func TestPlanOf(t *testing.T) {
	calendar, ok := PlanOf([]byte(`{"calendar":{"startedOn":"2026-10-26","items":[{"id":"a"}]}}`))
	if !ok || calendar.StartedOn != "2026-10-26" || len(calendar.Items) != 1 {
		t.Fatalf("PlanOf = %+v, %v", calendar, ok)
	}
	for _, raw := range []string{``, `{}`, `{"calendar":{}}`, `not json`} {
		if _, ok := PlanOf([]byte(raw)); ok {
			t.Fatalf("PlanOf(%q) found a plan", raw)
		}
	}
}

type stubSender struct {
	delivered int
	err       error
}

func (s stubSender) PublicKey() string { return "key" }

func (s stubSender) Send(context.Context, string, push.Message) (int, error) {
	return s.delivered, s.err
}

func TestRecorderKeepsOnlyDeliveredNotifications(t *testing.T) {
	ctx := context.Background()
	store := NewMemory()
	at := time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	message := push.Message{Title: "План готов", Body: "Откройте", URL: "./", Topic: push.Topic{Kind: push.KindPlan, PlanStart: "2026-10-26"}}

	for _, sender := range []stubSender{{delivered: 0}, {err: errors.New("down")}} {
		recorder := &Recorder{Sender: sender, Store: store, Logger: logger}
		_, _ = recorder.Send(ctx, "m1", message)
	}
	if entries, _ := store.List(ctx, "m1", ListLimit); len(entries) != 0 {
		t.Fatalf("undelivered pushes were recorded: %+v", entries)
	}

	recorder := &Recorder{Sender: stubSender{delivered: 2}, Store: store, Logger: logger, Now: func() time.Time { return at }}
	if sent, err := recorder.Send(ctx, "m1", message); sent != 2 || err != nil {
		t.Fatalf("Send = %d, %v", sent, err)
	}
	entries, _ := store.List(ctx, "m1", ListLimit)
	if len(entries) != 1 || entries[0].ID == "" || entries[0].Title != "План готов" || entries[0].Delivered != 2 ||
		!entries[0].SentAt.Equal(at) || entries[0].Topic.PlanStart != "2026-10-26" {
		t.Fatalf("entries = %+v", entries)
	}
	if recorder.PublicKey() != "key" {
		t.Fatal("public key is not passed through")
	}
}

func TestMemoryListsNewestFirstPerMasterAndPurges(t *testing.T) {
	ctx := context.Background()
	store := NewMemory()
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for index, master := range []string{"m1", "m2", "m1", "m1"} {
		_ = store.Add(ctx, Entry{ID: string(rune('a' + index)), MasterID: master, SentAt: base.AddDate(0, 0, index)})
	}
	entries, _ := store.List(ctx, "m1", 2)
	if len(entries) != 2 || entries[0].ID != "d" || entries[1].ID != "c" {
		t.Fatalf("entries = %+v", entries)
	}
	if _, err := store.Get(ctx, "m2", "a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another master read the entry: %v", err)
	}
	if removed, _ := store.Purge(ctx, base.AddDate(0, 0, 2)); removed != 2 {
		t.Fatalf("removed = %d", removed)
	}
	if entries, _ := store.List(ctx, "m1", ListLimit); len(entries) != 2 {
		t.Fatalf("after purge = %+v", entries)
	}
}
