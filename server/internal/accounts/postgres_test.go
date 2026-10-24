package accounts_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/store"
)

func openPostgres(t *testing.T) *accounts.Postgres {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	postgres, err := store.Open(context.Background(), url, slog.Default())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(postgres.Close)
	return accounts.NewPostgres(postgres.Pool())
}

func TestPostgresMastersStateAndUsage(t *testing.T) {
	db := openPostgres(t)
	ctx := context.Background()
	hash := "test-hash-" + time.Now().Format("150405.000000000")

	master, err := db.CreateMaster(ctx, "Тест", hash)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	found, err := db.FindByCodeHash(ctx, hash)
	if err != nil || found.ID != master.ID || found.Disabled {
		t.Fatalf("find = %+v, %v", found, err)
	}
	if _, err := db.FindByCodeHash(ctx, "missing-"+hash); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := db.Touch(ctx, master.ID, time.Now()); err != nil {
		t.Fatalf("touch: %v", err)
	}
	if err := db.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := db.SetDisabled(ctx, "missing", true); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := db.RenameMaster(ctx, master.ID, "Тест 2"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := db.RenameMaster(ctx, "missing", "Тест 2"); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if renamed, err := db.FindByCodeHash(ctx, hash); err != nil || renamed.Name != "Тест 2" {
		t.Errorf("renamed = %+v, %v", renamed, err)
	}

	if _, err := db.LoadState(ctx, master.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	first, err := db.SaveState(ctx, master.ID, 0, json.RawMessage(`{"a":1}`), time.Now())
	if err != nil || first.Version != 1 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := db.SaveState(ctx, master.ID, 1, json.RawMessage(`{"a":2}`), time.Now())
	if err != nil || second.Version != 2 {
		t.Fatalf("second = %+v, %v", second, err)
	}
	stale, err := db.SaveState(ctx, master.ID, 1, json.RawMessage(`{"a":3}`), time.Now())
	if !errors.Is(err, accounts.ErrConflict) || stale.Version != 2 {
		t.Errorf("stale = %+v, %v", stale, err)
	}
	if _, err := db.SaveState(ctx, master.ID, 0, json.RawMessage(`{}`), time.Now()); !errors.Is(err, accounts.ErrConflict) {
		t.Errorf("a repeated first save must conflict, got %v", err)
	}
	loaded, err := db.LoadState(ctx, master.ID)
	if err != nil || loaded.Version != 2 {
		t.Fatalf("loaded = %+v, %v", loaded, err)
	}

	day := time.Now().Add(-time.Hour)
	if err := db.RecordUsage(ctx, master.ID, "kit", time.Now()); err != nil {
		t.Fatalf("usage: %v", err)
	}
	count, err := db.CountUsage(ctx, master.ID, day)
	if err != nil || count != 1 {
		t.Errorf("count = %d, %v", count, err)
	}
	list, err := db.ListMasters(ctx, day)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, summary := range list {
		if summary.ID == master.ID && (summary.UsageToday != 1 || !summary.Disabled) {
			t.Errorf("summary = %+v", summary)
		}
	}
}

func TestPostgresHistoryEventsExportAndErasure(t *testing.T) {
	db := openPostgres(t)
	db.HistoryKeep = 3
	ctx := context.Background()
	master, err := db.CreateMaster(ctx, "Тест", "history-hash-"+time.Now().Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	for version := 0; version < 5; version++ {
		if _, err := db.SaveState(ctx, master.ID, version, json.RawMessage(`{"v":`+string(rune('0'+version))+`}`), time.Now()); err != nil {
			t.Fatalf("save %d: %v", version, err)
		}
	}
	versions, err := db.StateVersions(ctx, master.ID, 0)
	if err != nil || len(versions) != 3 || versions[0].Version != 5 || versions[2].Version != 3 {
		t.Fatalf("versions = %+v, %v", versions, err)
	}
	snapshot, err := db.StateSnapshot(ctx, master.ID, 4)
	if err != nil || snapshot.Version != 4 {
		t.Fatalf("snapshot = %+v, %v", snapshot, err)
	}
	if _, err := db.StateSnapshot(ctx, master.ID, 1); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("an old version must be gone, got %v", err)
	}

	old := time.Now().AddDate(-4, 0, 0)
	if err := db.RecordEvent(ctx, master.ID, "chat", json.RawMessage(`{"text":"старое"}`), old); err != nil {
		t.Fatalf("event: %v", err)
	}
	if err := db.RecordEvent(ctx, master.ID, "kit", json.RawMessage(`{"text":"новое"}`), time.Now()); err != nil {
		t.Fatalf("event: %v", err)
	}
	events, err := db.ListEvents(ctx, master.ID, 0)
	if err != nil || len(events) != 2 || events[0].Kind != "kit" {
		t.Fatalf("events = %+v, %v", events, err)
	}

	export, err := db.ExportMaster(ctx, master.ID)
	if err != nil || export.State == nil || len(export.History) != 3 || len(export.Events) != 2 || export.Events[0].Kind != "chat" {
		t.Fatalf("export = %+v, %v", export, err)
	}

	if _, err := db.Purge(ctx, time.Now().AddDate(-3, 0, 0)); err != nil {
		t.Fatalf("purge: %v", err)
	}
	events, _ = db.ListEvents(ctx, master.ID, 0)
	if len(events) != 1 || events[0].Kind != "kit" {
		t.Errorf("only the fresh event must stay, got %+v", events)
	}

	if err := db.DeleteMaster(ctx, master.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := db.LoadState(ctx, master.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("the state must be gone with the master, got %v", err)
	}
	if err := db.DeleteMaster(ctx, master.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}

func TestPostgresAuditJobs(t *testing.T) {
	db := openPostgres(t)
	ctx := context.Background()
	master, err := db.CreateMaster(ctx, "Тест", "jobs-hash-"+time.Now().Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = db.DeleteMaster(ctx, master.ID) })
	now := time.Now()

	job, err := db.CreateAuditJob(ctx, master.ID, "anna_nails", now)
	if err != nil || job.Status != accounts.JobQueued || job.MasterName != "Тест" {
		t.Fatalf("job = %+v, %v", job, err)
	}
	if active, err := db.CreateAuditJob(ctx, master.ID, "other", now); !errors.Is(err, accounts.ErrJobActive) || active.ID != job.ID {
		t.Errorf("a second active job must be refused with the first one, got %+v, %v", active, err)
	}

	claimed, err := db.ClaimAuditJob(ctx, now, time.Minute)
	if err != nil || claimed.ID != job.ID || claimed.Status != accounts.JobRunning || claimed.Attempts != 1 {
		t.Fatalf("claimed = %+v, %v", claimed, err)
	}
	if _, err := db.ClaimAuditJob(ctx, now.Add(time.Second), time.Minute); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("a running job must not be handed out twice, got %v", err)
	}

	if err := db.FailAuditJob(ctx, job.ID, "капча", false, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ClaimAuditJob(ctx, now, time.Minute); err != nil {
		t.Fatalf("a failed job returns to the queue: %v", err)
	}
	if err := db.CompleteAuditJob(ctx, job.ID, json.RawMessage(`{"summary":"ок"}`), now); err != nil {
		t.Fatal(err)
	}
	if err := db.CompleteAuditJob(ctx, job.ID, json.RawMessage(`{}`), now); !errors.Is(err, accounts.ErrJobState) {
		t.Errorf("err = %v", err)
	}
	done, err := db.LatestAuditJob(ctx, master.ID)
	if err != nil || done.Status != accounts.JobDone || string(done.Result) != `{"summary": "ок"}` && string(done.Result) != `{"summary":"ок"}` {
		t.Fatalf("done = %+v, %v", done, err)
	}

	next, err := db.CreateAuditJob(ctx, master.ID, "anna_nails", now.Add(time.Second))
	if err != nil {
		t.Fatalf("a new job after a finished one: %v", err)
	}
	if err := db.CancelAuditJob(ctx, "someone-else", next.ID, now); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if err := db.CancelAuditJob(ctx, master.ID, next.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := db.CancelAuditJob(ctx, master.ID, next.ID, now); !errors.Is(err, accounts.ErrJobState) {
		t.Errorf("err = %v", err)
	}
	jobs, err := db.ListAuditJobs(ctx, 10)
	if err != nil || len(jobs) == 0 || jobs[0].Result != nil {
		t.Errorf("jobs = %+v, %v", jobs, err)
	}
}

func TestPostgresIdentitiesAndTokens(t *testing.T) {
	db := openPostgres(t)
	ctx := context.Background()
	subject := "sub-" + time.Now().Format("150405.000000000")

	registered, err := db.RegisterIdentity(ctx, "Анна", "unused-"+subject, accounts.ProviderYandex, subject, "a@y.ru")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	found, err := db.FindByIdentity(ctx, accounts.ProviderYandex, subject)
	if err != nil || found.ID != registered.ID {
		t.Fatalf("found = %+v, %v", found, err)
	}
	if _, err := db.FindByIdentity(ctx, accounts.ProviderYandex, "missing-"+subject); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if _, err := db.RegisterIdentity(ctx, "Копия", "unused2-"+subject, accounts.ProviderYandex, subject, ""); !errors.Is(err, accounts.ErrIdentityTaken) {
		t.Errorf("duplicate identity: err = %v", err)
	}

	tokenHash := "token-" + subject
	if err := db.AddToken(ctx, registered.ID, tokenHash); err != nil {
		t.Fatalf("add token: %v", err)
	}
	byToken, err := db.FindByCodeHash(ctx, tokenHash)
	if err != nil || byToken.ID != registered.ID {
		t.Fatalf("by token = %+v, %v", byToken, err)
	}
	if err := db.AddToken(ctx, "missing", "x-"+subject); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	other, err := db.CreateMaster(ctx, "Мария", "hash-"+subject)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.LinkIdentity(ctx, other.ID, accounts.ProviderYandex, subject, ""); !errors.Is(err, accounts.ErrIdentityTaken) {
		t.Errorf("identity of another master: err = %v", err)
	}
	if err := db.LinkIdentity(ctx, other.ID, accounts.ProviderYandex, "b-"+subject, ""); err != nil {
		t.Fatalf("link: %v", err)
	}
	if err := db.LinkIdentity(ctx, other.ID, accounts.ProviderYandex, "b-"+subject, ""); err != nil {
		t.Errorf("linking the same identity again must be harmless: %v", err)
	}
	if err := db.LinkIdentity(ctx, other.ID, accounts.ProviderYandex, "c-"+subject, ""); !errors.Is(err, accounts.ErrIdentityTaken) {
		t.Errorf("a second account of one provider: err = %v", err)
	}
	if err := db.LinkIdentity(ctx, "missing", accounts.ProviderYandex, "d-"+subject, ""); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
	if providers, err := db.Providers(ctx, other.ID); err != nil || len(providers) != 1 || providers[0] != accounts.ProviderYandex {
		t.Errorf("providers = %v, %v", providers, err)
	}

	if err := db.DeleteMaster(ctx, registered.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.FindByIdentity(ctx, accounts.ProviderYandex, subject); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("identity survived the master: %v", err)
	}
	_ = db.DeleteMaster(ctx, other.ID)
}

func TestPostgresRemembersWhereTheMasterLives(t *testing.T) {
	db := openPostgres(t)
	ctx := context.Background()
	master, err := db.CreateMaster(ctx, "Тест города", "city-hash-"+time.Now().Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = db.DeleteMaster(ctx, master.ID) })

	if err := db.SetLocation(ctx, master.ID, "Иркутск", "Asia/Irkutsk"); err != nil {
		t.Fatalf("SetLocation: %v", err)
	}

	got, err := db.GetMaster(ctx, master.ID)
	if err != nil || got.City != "Иркутск" || got.Timezone != "Asia/Irkutsk" || got.Name != "Тест города" {
		t.Fatalf("got = %+v, %v", got, err)
	}
	listed, err := db.ListMasters(ctx, time.Now())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var seen bool
	for _, summary := range listed {
		if summary.ID == master.ID {
			seen = summary.City == "Иркутск" && summary.Timezone == "Asia/Irkutsk"
		}
	}
	if !seen {
		t.Error("the list must carry the city and the time zone")
	}
	if _, err := db.GetMaster(ctx, "missing-master"); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("unknown master: %v", err)
	}
	if err := db.SetLocation(ctx, "missing-master", "x", "y"); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("unknown master location: %v", err)
	}
}
