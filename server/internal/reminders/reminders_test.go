package reminders

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/push"
)

var irkutsk = time.FixedZone("irkutsk", 8*3600)

const calendarJSON = `{"calendar":{"startedOn":"2026-10-26","schedule":{"slots":[{"weekday":1,"time":"18:30"}],"publishTime":"19:00"},"items":[
{"id":"a","date":"2026-10-27","time":"19:00","format":"stories","idea":"Почему болит спина","done":false},
{"id":"b","date":"2026-10-28","time":"19:00","format":"post","idea":"Карусель","done":true}]}}`

func moment(day, clock string) time.Time {
	moment, err := time.ParseInLocation("2006-01-02 15:04", day+" "+clock, irkutsk)
	if err != nil {
		panic(err)
	}
	return moment
}

func keys(due []Reminder) []string {
	result := make([]string, 0, len(due))
	for _, reminder := range due {
		result = append(result, reminder.Key)
	}
	return result
}

func TestNothingIsDueBeforeTheLeadTime(t *testing.T) {
	due := Due(json.RawMessage(calendarJSON), moment("2026-10-27", "17:29"), irkutsk)

	if len(due) != 0 {
		t.Fatalf("due = %v", keys(due))
	}
}

func TestTheContentDayIsRemindedAnHourBefore(t *testing.T) {
	due := Due(json.RawMessage(calendarJSON), moment("2026-10-27", "17:30"), irkutsk)

	if len(due) != 1 || due[0].Key != "content:2026-10-27:18:30" || due[0].Title != TitleContentDay || due[0].URL != URLToday {
		t.Fatalf("due = %+v", due)
	}
}

func TestAPublicationIsRemindedFifteenMinutesBeforeWithItsIdea(t *testing.T) {
	due := Due(json.RawMessage(calendarJSON), moment("2026-10-27", "18:45"), irkutsk)

	if len(due) != 1 || due[0].Key != "item:a" || due[0].Title != TitlePublication || due[0].Body != "Сторис: Почему болит спина" {
		t.Fatalf("due = %+v", due)
	}
}

func TestPublicationsAlreadyMarkedAsDoneAreLeftAlone(t *testing.T) {
	due := Due(json.RawMessage(calendarJSON), moment("2026-10-28", "18:50"), irkutsk)

	for _, reminder := range due {
		if reminder.Key == "item:b" {
			t.Fatalf("a published item was reminded: %+v", due)
		}
	}
}

func TestAMissedReminderIsDroppedAfterTheWindow(t *testing.T) {
	late := moment("2026-10-27", "18:45").Add(Window)

	if due := Due(json.RawMessage(calendarJSON), late, irkutsk); len(due) != 0 {
		t.Fatalf("due = %v", keys(due))
	}
	if due := Due(json.RawMessage(calendarJSON), late.Add(-time.Minute), irkutsk); len(due) != 1 {
		t.Fatalf("a reminder inside the window was dropped: %v", keys(due))
	}
}

func TestTheTimeZoneOfTheMasterDecidesWhenTheDayStarts(t *testing.T) {
	moscow := time.FixedZone("moscow", 3*3600)
	moment, _ := time.ParseInLocation("2006-01-02 15:04", "2026-10-27 18:45", moscow)

	due := Due(json.RawMessage(calendarJSON), moment, moscow)

	if len(due) != 1 || due[0].Key != "item:a" {
		t.Fatalf("due = %v", keys(due))
	}
	if other := Due(json.RawMessage(calendarJSON), moment, irkutsk); len(other) != 0 {
		t.Fatalf("the same instant in another zone must not match: %v", keys(other))
	}
}

func TestBrokenOrEmptyDataGivesNothing(t *testing.T) {
	for _, raw := range []string{``, `{`, `{}`, `{"calendar":null}`, `{"calendar":{"startedOn":"x","items":[{"id":"a","date":"zz","time":"yy"}]}}`} {
		if due := Due(json.RawMessage(raw), moment("2026-10-27", "18:45"), irkutsk); len(due) != 0 {
			t.Errorf("%q: due = %v", raw, keys(due))
		}
	}
}

type fakeSender struct {
	messages map[string][]push.Message
}

func (f *fakeSender) Send(_ context.Context, masterID string, message push.Message) (int, error) {
	f.messages[masterID] = append(f.messages[masterID], message)
	return 1, nil
}

func (f *fakeSender) PublicKey() string { return "key" }

func newScheduler(t *testing.T, now time.Time) (*Scheduler, *accounts.Memory, *fakeSender) {
	t.Helper()
	store := accounts.NewMemory()
	sender := &fakeSender{messages: map[string][]push.Message{}}
	return &Scheduler{
		Accounts: store,
		Sender:   sender,
		Sent:     NewMemory(),
		Location: irkutsk,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:      func() time.Time { return now },
	}, store, sender
}

func masterWithPlan(t *testing.T, store *accounts.Memory, name string) accounts.Master {
	t.Helper()
	master, err := store.CreateMaster(context.Background(), name, "hash-"+name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveState(context.Background(), master.ID, 0, json.RawMessage(calendarJSON), time.Now()); err != nil {
		t.Fatal(err)
	}
	return master
}

func TestTheSchedulerSendsEachReminderOnlyOnce(t *testing.T) {
	scheduler, store, sender := newScheduler(t, moment("2026-10-27", "18:46"))
	master := masterWithPlan(t, store, "Анна")

	scheduler.Tick(context.Background())
	scheduler.Tick(context.Background())

	sent := sender.messages[master.ID]
	if len(sent) != 1 || !strings.Contains(sent[0].Body, "Почему болит спина") {
		t.Fatalf("sent = %+v", sent)
	}
}

func TestTheSchedulerSkipsDisabledMastersAndMastersWithoutAPlan(t *testing.T) {
	scheduler, store, sender := newScheduler(t, moment("2026-10-27", "18:46"))
	disabled := masterWithPlan(t, store, "Вера")
	if err := store.SetDisabled(context.Background(), disabled.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateMaster(context.Background(), "Без плана", "hash-empty"); err != nil {
		t.Fatal(err)
	}

	scheduler.Tick(context.Background())

	if len(sender.messages) != 0 {
		t.Fatalf("messages = %+v", sender.messages)
	}
}

func TestTheSchedulerSendsTheNextReminderLater(t *testing.T) {
	now := moment("2026-10-27", "17:31")
	scheduler, store, sender := newScheduler(t, now)
	scheduler.Now = func() time.Time { return now }
	master := masterWithPlan(t, store, "Анна")

	scheduler.Tick(context.Background())
	now = moment("2026-10-27", "18:46")
	scheduler.Tick(context.Background())

	sent := sender.messages[master.ID]
	if len(sent) != 2 || sent[0].Title != TitleContentDay || sent[1].Title != TitlePublication {
		t.Fatalf("sent = %+v", sent)
	}
}

func TestOldMarksAreForgotten(t *testing.T) {
	sent := NewMemory()
	ctx := context.Background()
	_ = sent.Mark(ctx, "m1", "old", time.Now().Add(-90*24*time.Hour))
	_ = sent.Mark(ctx, "m1", "new", time.Now())

	if err := sent.Forget(ctx, time.Now().Add(-ForgetAfter)); err != nil {
		t.Fatal(err)
	}

	if has, _ := sent.Has(ctx, "m1", "old"); has {
		t.Error("an old mark survived")
	}
	if has, _ := sent.Has(ctx, "m1", "new"); !has {
		t.Error("a fresh mark was lost")
	}
}
