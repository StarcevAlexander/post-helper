package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestMemoryStateVersions(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()

	if _, err := store.LoadState(ctx, "m1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	first, err := store.SaveState(ctx, "m1", 0, json.RawMessage(`{"a":1}`), now)
	if err != nil || first.Version != 1 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := store.SaveState(ctx, "m1", 1, json.RawMessage(`{"a":2}`), now)
	if err != nil || second.Version != 2 {
		t.Fatalf("second = %+v, %v", second, err)
	}

	stale, err := store.SaveState(ctx, "m1", 1, json.RawMessage(`{"a":3}`), now)
	if !errors.Is(err, ErrConflict) || stale.Version != 2 || string(stale.Data) != `{"a":2}` {
		t.Errorf("stale = %+v, %v", stale, err)
	}
	if _, err := store.SaveState(ctx, "m1", 0, json.RawMessage(`{}`), now); !errors.Is(err, ErrConflict) {
		t.Errorf("a second first save must conflict, got %v", err)
	}
}

func TestMemoryUsageCounts(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	other, _ := store.CreateMaster(ctx, "Вера", "hash2")
	day := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	_ = store.RecordUsage(ctx, master.ID, "kit", day.Add(-time.Hour))
	_ = store.RecordUsage(ctx, master.ID, "kit", day.Add(time.Hour))
	_ = store.RecordUsage(ctx, master.ID, "strategy", day.Add(2*time.Hour))
	_ = store.RecordUsage(ctx, other.ID, "kit", day.Add(time.Hour))

	today, _ := store.CountUsage(ctx, master.ID, day)
	list, _ := store.ListMasters(ctx, day)

	if today != 2 {
		t.Errorf("today = %d", today)
	}
	byID := map[string]MasterSummary{}
	for _, summary := range list {
		byID[summary.ID] = summary
	}
	if len(list) != 2 || byID[master.ID].UsageToday != 2 || byID[master.ID].UsageTotal != 3 || byID[other.ID].UsageTotal != 1 {
		t.Errorf("list = %+v", list)
	}
}

func TestMemoryMasters(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")

	found, err := store.FindByCodeHash(ctx, "hash")
	if err != nil || found.ID != master.ID {
		t.Fatalf("found = %+v, %v", found, err)
	}
	if _, err := store.FindByCodeHash(ctx, "other"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := store.SetDisabled(ctx, "missing", true); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := store.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatal(err)
	}
	found, _ = store.FindByCodeHash(ctx, "hash")
	if !found.Disabled {
		t.Error("master must be disabled")
	}
	if err := store.RenameMaster(ctx, "missing", "Мария"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := store.RenameMaster(ctx, master.ID, "Мария"); err != nil {
		t.Fatal(err)
	}
	found, _ = store.FindByCodeHash(ctx, "hash")
	if found.Name != "Мария" {
		t.Errorf("name = %q", found.Name)
	}
}

func TestMemoryStateHistoryKeepsTheLastVersionsOnly(t *testing.T) {
	store := NewMemory()
	store.HistoryKeep = 3
	ctx := context.Background()
	now := time.Now()
	for version := 0; version < 5; version++ {
		if _, err := store.SaveState(ctx, "m1", version, json.RawMessage(`{"v":`+string(rune('0'+version))+`}`), now); err != nil {
			t.Fatal(err)
		}
	}

	versions, _ := store.StateVersions(ctx, "m1", 0)

	if len(versions) != 3 || versions[0].Version != 5 || versions[2].Version != 3 {
		t.Fatalf("versions = %+v", versions)
	}
	if _, err := store.StateSnapshot(ctx, "m1", 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("an old version must be gone, got %v", err)
	}
	snapshot, err := store.StateSnapshot(ctx, "m1", 4)
	if err != nil || string(snapshot.Data) != `{"v":3}` {
		t.Errorf("snapshot = %+v, %v", snapshot, err)
	}
}

func TestMemoryEventsAreNewestFirstAndPerMaster(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = store.RecordEvent(ctx, "m1", "chat", json.RawMessage(`{"n":1}`), now)
	_ = store.RecordEvent(ctx, "m2", "kit", json.RawMessage(`{"n":2}`), now)
	_ = store.RecordEvent(ctx, "m1", "strategy", json.RawMessage(`{"n":3}`), now.Add(time.Second))

	events, _ := store.ListEvents(ctx, "m1", 0)
	limited, _ := store.ListEvents(ctx, "m1", 1)

	if len(events) != 2 || events[0].Kind != "strategy" || events[1].Kind != "chat" {
		t.Errorf("events = %+v", events)
	}
	if len(limited) != 1 || limited[0].Kind != "strategy" {
		t.Errorf("limited = %+v", limited)
	}
}

func TestMemoryExportHasEverythingOfOneMaster(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	other, _ := store.CreateMaster(ctx, "Вера", "hash2")
	_, _ = store.SaveState(ctx, master.ID, 0, json.RawMessage(`{"a":1}`), time.Now())
	_ = store.RecordEvent(ctx, master.ID, "chat", json.RawMessage(`{}`), time.Now())
	_ = store.RecordEvent(ctx, other.ID, "chat", json.RawMessage(`{}`), time.Now())

	export, err := store.ExportMaster(ctx, master.ID)

	if err != nil || export.Master.Name != "Анна" || export.State == nil || len(export.History) != 1 || len(export.Events) != 1 {
		t.Fatalf("export = %+v, %v", export, err)
	}
	if _, err := store.ExportMaster(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}

func TestMemoryDeleteMasterRemovesEverything(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	_, _ = store.SaveState(ctx, master.ID, 0, json.RawMessage(`{}`), time.Now())
	_ = store.RecordEvent(ctx, master.ID, "chat", json.RawMessage(`{}`), time.Now())
	_ = store.RecordUsage(ctx, master.ID, "chat", time.Now())

	if err := store.DeleteMaster(ctx, master.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := store.FindByCodeHash(ctx, "hash"); !errors.Is(err, ErrNotFound) {
		t.Error("the master must be gone")
	}
	if _, err := store.LoadState(ctx, master.ID); !errors.Is(err, ErrNotFound) {
		t.Error("the state must be gone")
	}
	events, _ := store.ListEvents(ctx, master.ID, 0)
	versions, _ := store.StateVersions(ctx, master.ID, 0)
	count, _ := store.CountUsage(ctx, master.ID, time.Time{})
	if len(events) != 0 || len(versions) != 0 || count != 0 {
		t.Errorf("leftovers: %d events, %d versions, %d usage", len(events), len(versions), count)
	}
	if err := store.DeleteMaster(ctx, master.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}

func TestMemoryPurgeDropsOldRecordsButKeepsTheLatestVersion(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	old := time.Now().AddDate(-4, 0, 0)
	fresh := time.Now()
	_, _ = store.SaveState(ctx, "m1", 0, json.RawMessage(`{"v":1}`), old)
	_, _ = store.SaveState(ctx, "m1", 1, json.RawMessage(`{"v":2}`), old)
	_, _ = store.SaveState(ctx, "m1", 2, json.RawMessage(`{"v":3}`), fresh)
	_, _ = store.SaveState(ctx, "m2", 0, json.RawMessage(`{"v":1}`), old)
	_ = store.RecordEvent(ctx, "m1", "chat", json.RawMessage(`{}`), old)
	_ = store.RecordEvent(ctx, "m1", "chat", json.RawMessage(`{}`), fresh)
	_ = store.RecordUsage(ctx, "m1", "chat", old)

	removed, err := store.Purge(ctx, time.Now().AddDate(-3, 0, 0))

	if err != nil || removed != 4 {
		t.Fatalf("removed = %d, %v", removed, err)
	}
	events, _ := store.ListEvents(ctx, "m1", 0)
	versions, _ := store.StateVersions(ctx, "m1", 0)
	lone, _ := store.StateVersions(ctx, "m2", 0)
	if len(events) != 1 || len(versions) != 1 || versions[0].Version != 3 {
		t.Errorf("events = %d, versions = %+v", len(events), versions)
	}
	if len(lone) != 1 {
		t.Errorf("the only version of a master must stay, got %+v", lone)
	}
}

func TestMemoryAuditJobLifecycle(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")

	job, err := store.CreateAuditJob(ctx, master.ID, "anna_nails", now)
	if err != nil || job.Status != JobQueued || job.MasterName != "Анна" {
		t.Fatalf("job = %+v, %v", job, err)
	}
	if _, err := store.CreateAuditJob(ctx, master.ID, "other", now); !errors.Is(err, ErrJobActive) {
		t.Errorf("a second active job must be refused, got %v", err)
	}
	if _, err := store.CreateAuditJob(ctx, "missing", "x", now); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	claimed, err := store.ClaimAuditJob(ctx, now, time.Minute)
	if err != nil || claimed.ID != job.ID || claimed.Status != JobRunning || claimed.Attempts != 1 {
		t.Fatalf("claimed = %+v, %v", claimed, err)
	}
	if _, err := store.ClaimAuditJob(ctx, now.Add(time.Second), time.Minute); !errors.Is(err, ErrNotFound) {
		t.Errorf("a running job must not be handed out twice, got %v", err)
	}

	if err := store.CompleteAuditJob(ctx, job.ID, json.RawMessage(`{"summary":"ок"}`), now); err != nil {
		t.Fatal(err)
	}
	done, _ := store.AuditJob(ctx, job.ID)
	if done.Status != JobDone || string(done.Result) != `{"summary":"ок"}` || done.FinishedAt.IsZero() {
		t.Errorf("done = %+v", done)
	}
	if err := store.CompleteAuditJob(ctx, job.ID, json.RawMessage(`{}`), now); !errors.Is(err, ErrJobState) {
		t.Errorf("a finished job must not complete twice, got %v", err)
	}
	if err := store.CompleteAuditJob(ctx, "missing", json.RawMessage(`{}`), now); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if _, err := store.CreateAuditJob(ctx, master.ID, "anna_nails", now); err != nil {
		t.Errorf("a new job is allowed once the old one is finished, got %v", err)
	}
}

func TestMemoryAuditJobLeaseAndRetries(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	job, _ := store.CreateAuditJob(ctx, master.ID, "anna_nails", now)

	for attempt := 1; attempt <= MaxJobAttempts; attempt++ {
		claimed, err := store.ClaimAuditJob(ctx, now.Add(time.Duration(attempt)*time.Hour), time.Minute)
		if err != nil || claimed.Attempts != attempt {
			t.Fatalf("attempt %d: %+v, %v", attempt, claimed, err)
		}
	}
	if _, err := store.ClaimAuditJob(ctx, now.Add(10*time.Hour), time.Minute); !errors.Is(err, ErrNotFound) {
		t.Errorf("an abandoned job must stop being handed out, got %v", err)
	}
	abandoned, _ := store.AuditJob(ctx, job.ID)
	if abandoned.Status != JobFailed || abandoned.Error == "" {
		t.Errorf("abandoned = %+v", abandoned)
	}
}

func TestMemoryAuditJobFailureReturnsToTheQueueUntilTheLimit(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	job, _ := store.CreateAuditJob(ctx, master.ID, "anna_nails", now)

	_, _ = store.ClaimAuditJob(ctx, now, time.Hour)
	if err := store.FailAuditJob(ctx, job.ID, "вход потребовал капчу", false, now); err != nil {
		t.Fatal(err)
	}
	again, _ := store.AuditJob(ctx, job.ID)
	if again.Status != JobQueued || again.Error != "вход потребовал капчу" {
		t.Fatalf("again = %+v", again)
	}

	_, _ = store.ClaimAuditJob(ctx, now, time.Hour)
	if err := store.FailAuditJob(ctx, job.ID, "профиль закрыт", true, now); err != nil {
		t.Fatal(err)
	}
	final, _ := store.AuditJob(ctx, job.ID)
	if final.Status != JobFailed || final.FinishedAt.IsZero() {
		t.Errorf("final = %+v", final)
	}
	if err := store.FailAuditJob(ctx, job.ID, "ещё раз", true, now); !errors.Is(err, ErrJobState) {
		t.Errorf("err = %v", err)
	}
}

func TestMemoryAuditJobFailsForGoodAfterTheLastAttempt(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")
	job, _ := store.CreateAuditJob(ctx, master.ID, "anna_nails", now)

	for attempt := 1; attempt <= MaxJobAttempts; attempt++ {
		_, _ = store.ClaimAuditJob(ctx, now, time.Hour)
		_ = store.FailAuditJob(ctx, job.ID, "сбой", false, now)
	}

	last, _ := store.AuditJob(ctx, job.ID)
	if last.Status != JobFailed {
		t.Errorf("status = %s", last.Status)
	}
}

func TestMemoryAuditJobCancelAndListing(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	now := time.Now()
	anna, _ := store.CreateMaster(ctx, "Анна", "hash")
	vera, _ := store.CreateMaster(ctx, "Вера", "hash2")
	first, _ := store.CreateAuditJob(ctx, anna.ID, "anna_nails", now)

	if err := store.CancelAuditJob(ctx, vera.ID, first.ID, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("someone else's job must not be cancelled, got %v", err)
	}
	if err := store.CancelAuditJob(ctx, anna.ID, first.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.CancelAuditJob(ctx, anna.ID, first.ID, now); !errors.Is(err, ErrJobState) {
		t.Errorf("err = %v", err)
	}
	if _, err := store.ClaimAuditJob(ctx, now, time.Hour); !errors.Is(err, ErrNotFound) {
		t.Errorf("a cancelled job must not be handed out, got %v", err)
	}

	second, _ := store.CreateAuditJob(ctx, anna.ID, "anna_nails2", now.Add(time.Second))
	_, _ = store.ClaimAuditJob(ctx, now, time.Hour)
	_ = store.CompleteAuditJob(ctx, second.ID, json.RawMessage(`{"big":true}`), now)

	latest, _ := store.LatestAuditJob(ctx, anna.ID)
	list, _ := store.ListAuditJobs(ctx, 10)
	if latest.ID != second.ID || len(latest.Result) == 0 {
		t.Errorf("latest = %+v", latest)
	}
	if len(list) != 2 || list[0].ID != second.ID || list[0].Result != nil {
		t.Errorf("the list must be newest first and without results, got %+v", list)
	}
	if _, err := store.LatestAuditJob(ctx, vera.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	_ = store.DeleteMaster(ctx, anna.ID)
	if _, err := store.AuditJob(ctx, second.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("jobs must go with the master, got %v", err)
	}
}

func TestMemoryIdentitiesAndTokens(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()

	registered, err := store.RegisterIdentity(ctx, "Анна", "unused-hash", ProviderYandex, "42", "a@y.ru")
	if err != nil {
		t.Fatal(err)
	}
	found, err := store.FindByIdentity(ctx, ProviderYandex, "42")
	if err != nil || found.ID != registered.ID {
		t.Fatalf("found = %+v, %v", found, err)
	}
	if _, err := store.FindByIdentity(ctx, ProviderYandex, "other"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if _, err := store.RegisterIdentity(ctx, "Копия", "h2", ProviderYandex, "42", ""); !errors.Is(err, ErrIdentityTaken) {
		t.Errorf("duplicate identity: err = %v", err)
	}

	if err := store.AddToken(ctx, registered.ID, "token-hash"); err != nil {
		t.Fatal(err)
	}
	byToken, err := store.FindByCodeHash(ctx, "token-hash")
	if err != nil || byToken.ID != registered.ID {
		t.Fatalf("by token = %+v, %v", byToken, err)
	}
	if err := store.AddToken(ctx, "missing", "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	other, _ := store.CreateMaster(ctx, "Мария", "hash-m")
	if err := store.LinkIdentity(ctx, other.ID, ProviderYandex, "42", ""); !errors.Is(err, ErrIdentityTaken) {
		t.Errorf("identity of another master: err = %v", err)
	}
	if err := store.LinkIdentity(ctx, other.ID, ProviderYandex, "77", ""); err != nil {
		t.Fatal(err)
	}
	if err := store.LinkIdentity(ctx, other.ID, ProviderYandex, "77", ""); err != nil {
		t.Errorf("linking the same identity again must be harmless: %v", err)
	}
	if err := store.LinkIdentity(ctx, other.ID, ProviderYandex, "88", ""); !errors.Is(err, ErrIdentityTaken) {
		t.Errorf("a second account of one provider: err = %v", err)
	}
	if err := store.LinkIdentity(ctx, "missing", ProviderYandex, "99", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	providers, _ := store.Providers(ctx, other.ID)
	if len(providers) != 1 || providers[0] != ProviderYandex {
		t.Errorf("providers = %v", providers)
	}
}

func TestMemoryKeepsOnlyTheNewestTokens(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash")

	for i := range MaxTokensPerMaster + 3 {
		_ = store.AddToken(ctx, master.ID, "token-"+string(rune('a'+i)))
	}

	if _, err := store.FindByCodeHash(ctx, "token-a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("the oldest token must be gone: %v", err)
	}
	newest := "token-" + string(rune('a'+MaxTokensPerMaster+2))
	if _, err := store.FindByCodeHash(ctx, newest); err != nil {
		t.Errorf("the newest token must stay: %v", err)
	}
}

func TestMemoryDeleteMasterDropsIdentitiesAndTokens(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.RegisterIdentity(ctx, "Анна", "h", ProviderYandex, "42", "")
	_ = store.AddToken(ctx, master.ID, "token-hash")

	if err := store.DeleteMaster(ctx, master.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := store.FindByIdentity(ctx, ProviderYandex, "42"); !errors.Is(err, ErrNotFound) {
		t.Errorf("identity survived: %v", err)
	}
	if _, err := store.FindByCodeHash(ctx, "token-hash"); !errors.Is(err, ErrNotFound) {
		t.Errorf("token survived: %v", err)
	}
}

func TestMemoryRemembersWhereTheMasterLives(t *testing.T) {
	store := NewMemory()
	ctx := context.Background()
	master, _ := store.CreateMaster(ctx, "Анна", "hash-1")

	before, err := store.GetMaster(ctx, master.ID)
	if err != nil || before.City != "" || before.Timezone != "" {
		t.Fatalf("before = %+v, %v", before, err)
	}
	if err := store.SetLocation(ctx, master.ID, "Иркутск", "Asia/Irkutsk"); err != nil {
		t.Fatalf("SetLocation: %v", err)
	}

	after, err := store.GetMaster(ctx, master.ID)
	if err != nil || after.City != "Иркутск" || after.Timezone != "Asia/Irkutsk" {
		t.Fatalf("after = %+v, %v", after, err)
	}
	listed, _ := store.ListMasters(ctx, time.Now())
	if len(listed) != 1 || listed[0].City != "Иркутск" {
		t.Errorf("listed = %+v", listed)
	}
	if _, err := store.GetMaster(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown master: %v", err)
	}
	if err := store.SetLocation(ctx, "missing", "x", "y"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown master location: %v", err)
	}
}
