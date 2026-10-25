package digest

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/push"
)

var irkutsk = time.FixedZone("irkutsk", 8*3600)

const planJSON = `{"calendar":{"startedOn":"2026-10-19","schedule":{"slots":[]},"items":[
{"id":"a","date":"2026-10-20","time":"19:00","format":"post","idea":"A","done":true},
{"id":"b","date":"2026-10-22","time":"19:00","format":"post","idea":"B","done":false},
{"id":"c","date":"2026-10-26","time":"19:00","format":"post","idea":"C","done":false},
{"id":"d","date":"2026-10-29","time":"19:00","format":"post","idea":"D","done":false},
{"id":"e","date":"2026-11-15","time":"19:00","format":"post","idea":"E","done":false}]}}`

type fakeNotifier struct {
	mu   sync.Mutex
	sent []string
	err  error
}

func (f *fakeNotifier) Notify(_ context.Context, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, text)
	return nil
}

func (f *fakeNotifier) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

func moment(day, clock string) time.Time {
	parsed, err := time.ParseInLocation("2006-01-02 15:04", day+" "+clock, irkutsk)
	if err != nil {
		panic(err)
	}
	return parsed
}

func newScheduler(now time.Time) (*Scheduler, *accounts.Memory, *push.Memory, *intake.Memory, *fakeNotifier) {
	store := accounts.NewMemory()
	pushes := push.NewMemory()
	intakes := intake.NewMemory()
	notifier := &fakeNotifier{}
	scheduler := &Scheduler{
		Accounts: store,
		Pushes:   pushes,
		Intakes:  intakes,
		Notifier: notifier,
		Sent:     NewMemory(),
		Location: irkutsk,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:      func() time.Time { return now },
	}
	return scheduler, store, pushes, intakes, notifier
}

func masterWithPlan(t *testing.T, store *accounts.Memory, name string) accounts.Master {
	t.Helper()
	master, err := store.CreateMaster(context.Background(), name, "hash-"+name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveState(context.Background(), master.ID, 0, json.RawMessage(planJSON), time.Now()); err != nil {
		t.Fatal(err)
	}
	return master
}

func TestTheReportCountsPublishedOverdueAndTheComingWeek(t *testing.T) {
	scheduler, store, pushes, _, _ := newScheduler(moment("2026-10-26", "09:05"))
	master := masterWithPlan(t, store, "Анна")
	_ = store.SetLocation(context.Background(), master.ID, "Иркутск", "Asia/Irkutsk")
	_ = store.Touch(context.Background(), master.ID, moment("2026-10-24", "12:00"))
	_ = pushes.Save(context.Background(), master.ID, push.Subscription{Endpoint: "https://push.example/1", P256dh: "k", Auth: "a"}, time.Now())

	report, err := scheduler.Build(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	text := Render(report)

	if len(report.Masters) != 1 || report.WithPlan != 1 {
		t.Fatalf("report = %+v", report)
	}
	row := report.Masters[0]
	if row.PlannedSoFar != 3 || row.DoneSoFar != 1 || row.Overdue != 1 || row.ThisWeek != 1 || row.EndsOn != "2026-11-15" || row.DaysLeft != 20 {
		t.Errorf("row = %+v", row)
	}
	for _, want := range []string{"Недельный дайджест, пн 26 окт", "Мастеров: 1, с планом: 1", "Анна (Иркутск)",
		"Опубликовано 1 из 3 за прошедшие дни, не отмечено 1", "На этой неделе публикаций: 1, календарь до 15 ноя (дней: 20)",
		"Напоминания включены, в приложении 2 дн. назад"} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q:\n%s", want, text)
		}
	}
}

func TestMastersWithoutAPlanAndWaitingRequestsAreListed(t *testing.T) {
	scheduler, store, _, intakes, _ := newScheduler(moment("2026-10-26", "09:05"))
	master, _ := store.CreateMaster(context.Background(), "Вера", "hash-v")
	draft := intake.Draft{Networks: []intake.Network{{Platform: intake.PlatformVK, URL: "https://vk.com/vera"}}, Goals: []string{"reach"}}
	_, _, _ = intakes.Submit(context.Background(), master.ID, draft, moment("2026-10-24", "10:00"))
	disabled, _ := store.CreateMaster(context.Background(), "Отключена", "hash-d")
	_ = store.SetDisabled(context.Background(), disabled.ID, true)

	report, _ := scheduler.Build(context.Background())
	text := Render(report)

	if len(report.Masters) != 1 || report.WithPlan != 0 {
		t.Fatalf("report = %+v", report)
	}
	for _, want := range []string{"Вера", "Плана нет", "Ждёт план с 24 окт", "Напоминания выключены, в приложение не заходила"} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "Отключена") {
		t.Errorf("a disabled master leaked into the digest:\n%s", text)
	}
}

func TestAnEmptyServerStillSendsAShortDigest(t *testing.T) {
	scheduler, _, _, _, _ := newScheduler(moment("2026-10-26", "09:05"))

	report, _ := scheduler.Build(context.Background())

	if text := Render(report); !strings.Contains(text, LineNobody) {
		t.Errorf("text = %s", text)
	}
}

func TestTheDigestGoesOutOncePerWeekOnMondayMorning(t *testing.T) {
	now := moment("2026-10-25", "09:05")
	scheduler, store, _, _, notifier := newScheduler(now)
	scheduler.Now = func() time.Time { return now }
	masterWithPlan(t, store, "Анна")

	scheduler.Tick(context.Background())
	if notifier.count() != 0 {
		t.Fatal("sunday must stay quiet")
	}
	now = moment("2026-10-26", "08:59")
	scheduler.Tick(context.Background())
	if notifier.count() != 0 {
		t.Fatal("too early on monday")
	}
	now = moment("2026-10-26", "09:00")
	scheduler.Tick(context.Background())
	now = moment("2026-10-26", "15:00")
	scheduler.Tick(context.Background())
	now = moment("2026-11-02", "09:10")
	scheduler.Tick(context.Background())

	if notifier.count() != 2 {
		t.Fatalf("sent %d digests, want one per monday", notifier.count())
	}
}

func TestAFailedDigestIsRetriedOnTheNextTick(t *testing.T) {
	scheduler, store, _, _, notifier := newScheduler(moment("2026-10-26", "09:05"))
	masterWithPlan(t, store, "Анна")
	notifier.err = context.DeadlineExceeded

	scheduler.Tick(context.Background())
	notifier.err = nil
	scheduler.Tick(context.Background())
	scheduler.Tick(context.Background())

	if notifier.count() != 1 {
		t.Fatalf("sent %d, want exactly one after the retry", notifier.count())
	}
}

func TestAMasterInAnotherZoneIsMeasuredByHerOwnDay(t *testing.T) {
	scheduler, store, _, _, _ := newScheduler(moment("2026-10-26", "02:30"))
	master := masterWithPlan(t, store, "Вера")
	_ = store.SetLocation(context.Background(), master.ID, "Калининград", "Europe/Kaliningrad")

	report, _ := scheduler.Build(context.Background())

	if row := report.Masters[0]; row.PlannedSoFar != 2 || row.Overdue != 1 {
		t.Errorf("in Kaliningrad it is still the 25th, row = %+v", row)
	}
}
