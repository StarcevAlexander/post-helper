package media_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/media"
	"post-helper/server/internal/store"
)

func openStores(t *testing.T) (*media.Postgres, *accounts.Postgres) {
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
	return media.NewPostgres(postgres.Pool()), accounts.NewPostgres(postgres.Pool())
}

func TestPostgresMediaLifecycle(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	master, err := people.CreateMaster(ctx, "Тест", "media-hash-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })

	item := func(id string, created time.Time) media.Item {
		return media.Item{
			ID: id + master.ID, MasterID: master.ID, Key: "w1-mon", Unit: "w1-mon:frame:0", Kind: media.KindVideo,
			Format: media.FormatReels, Pillar: "Процесс", Idea: "Гель-лак", Overlay: "До", Status: media.StatusQueued,
			CreatedAt: created, Source: media.Source{Name: "a.mov", Type: "video/quicktime", Size: 12},
			SourceRef: master.ID + "/" + id + "-source.mov",
		}
	}
	first, second := item("a", now.Add(-time.Minute)), item("b", now)
	if err := db.Create(ctx, first, 2); err != nil {
		t.Fatalf("create first: %v", err)
	}
	if err := db.Create(ctx, second, 2); err != nil {
		t.Fatalf("create second: %v", err)
	}
	if err := db.Create(ctx, item("c", now), 2); !errors.Is(err, media.ErrTooMany) {
		t.Fatalf("third item over the limit: %v", err)
	}

	listed, err := db.List(ctx, master.ID)
	if err != nil || len(listed) != 2 || listed[0].ID != first.ID || listed[0].Source.Size != 12 {
		t.Fatalf("list = %+v, %v", listed, err)
	}
	claimed, err := db.Claim(ctx, now, media.Lease)
	if err != nil || claimed.ID != first.ID || claimed.Attempts != 1 || claimed.Status != media.StatusRunning {
		t.Fatalf("claim = %+v, %v", claimed, err)
	}
	if _, err := db.Complete(ctx, second.ID, media.Result{}, "r", "t", now); !errors.Is(err, media.ErrState) {
		t.Errorf("complete of a queued item: %v", err)
	}
	ref, err := db.Complete(ctx, first.ID, media.Result{Type: media.ResultVideoType, Size: 7, Width: 1080, Height: 1920, DurationMs: 9000, Subtitled: true, Note: "ок"}, "r.mp4", "t.jpg", now)
	if err != nil || ref != first.SourceRef {
		t.Fatalf("complete = %q, %v", ref, err)
	}
	done, err := db.Get(ctx, master.ID, first.ID)
	if err != nil || done.Status != media.StatusDone || done.SourceRef != "" || done.ResultRef != "r.mp4" ||
		!done.Result.Subtitled || done.Result.Width != 1080 || !done.Result.Thumb || done.FinishedAt.IsZero() {
		t.Fatalf("done = %+v, %v", done, err)
	}

	again, err := db.Claim(ctx, now, media.Lease)
	if err != nil || again.ID != second.ID {
		t.Fatalf("claim of the second = %+v, %v", again, err)
	}
	if ref, err := db.Fail(ctx, second.ID, "сбой", false, now); err != nil || ref != "" {
		t.Fatalf("soft fail = %q, %v", ref, err)
	}
	if _, err := db.Claim(ctx, now, media.Lease); err != nil {
		t.Fatalf("claim after a soft fail: %v", err)
	}
	if ref, err := db.Fail(ctx, second.ID, "конец", true, now); err != nil || ref != second.SourceRef {
		t.Fatalf("final fail = %q, %v", ref, err)
	}
	if _, err := db.Fail(ctx, second.ID, "ещё", false, now); !errors.Is(err, media.ErrState) {
		t.Errorf("fail of a failed item: %v", err)
	}
	active, finished, err := db.Remaining(ctx, master.ID)
	if err != nil || active != 0 || finished != 1 {
		t.Errorf("remaining = %d, %d, %v", active, finished, err)
	}
	if owner, err := db.MasterOf(ctx, first.ID); err != nil || owner != master.ID {
		t.Errorf("master of = %q, %v", owner, err)
	}
	if _, err := db.Get(ctx, "other-master", first.ID); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("get by another master: %v", err)
	}

	refs, err := db.Purge(ctx, now.Add(time.Hour))
	if err != nil || len(refs) < 2 {
		t.Fatalf("purge = %v, %v", refs, err)
	}
	if left, _ := db.List(ctx, master.ID); len(left) != 0 {
		t.Errorf("left after purge: %+v", left)
	}
}

func TestPostgresExpireFailsItemsThatRanOutOfAttempts(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now().UTC()
	master, err := people.CreateMaster(ctx, "Тест", "media-expire-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })
	item := media.Item{
		ID: "exp" + master.ID, MasterID: master.ID, Key: "k", Kind: media.KindPhoto, Format: media.FormatPost,
		Status: media.StatusQueued, CreatedAt: now, SourceRef: master.ID + "/exp-source.jpg",
	}
	if err := db.Create(ctx, item, 0); err != nil {
		t.Fatalf("create: %v", err)
	}
	for attempt := 1; attempt <= media.MaxAttempts; attempt++ {
		when := now.Add(time.Duration(attempt) * media.Lease * 2)
		if claimed, err := db.Claim(ctx, when, media.Lease); err != nil || claimed.Attempts != attempt {
			t.Fatalf("claim %d = %+v, %v", attempt, claimed, err)
		}
	}

	refs, err := db.Expire(ctx, now.Add(10*media.Lease), media.Lease)

	if err != nil || len(refs) != 1 || refs[0] != item.SourceRef {
		t.Fatalf("expire = %v, %v", refs, err)
	}
	stored, _ := db.Find(ctx, item.ID)
	if stored.Status != media.StatusFailed || stored.Error != media.DefaultFailReason || stored.SourceRef != "" {
		t.Errorf("stored = %+v", stored)
	}
}
