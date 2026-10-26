package media

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func sample(id, masterID string, created time.Time) Item {
	return Item{
		ID: id, MasterID: masterID, Key: "w1-mon", Kind: KindVideo, Format: FormatReels, Status: StatusQueued,
		CreatedAt: created, Source: Source{Name: "a.mov", Type: "video/quicktime", Size: 10}, SourceRef: masterID + "/" + id + "-source.mov",
	}
}

func TestCreateKeepsTheLimitPerMaster(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()

	for index := range 3 {
		if err := memory.Create(ctx, sample(string(rune('a'+index)), "m1", now), 3); err != nil {
			t.Fatalf("create %d: %v", index, err)
		}
	}

	if err := memory.Create(ctx, sample("z", "m1", now), 3); !errors.Is(err, ErrTooMany) {
		t.Errorf("fourth item: %v", err)
	}
	if err := memory.Create(ctx, sample("y", "m2", now), 3); err != nil {
		t.Errorf("another master: %v", err)
	}
}

func TestClaimTakesTheOldestAndCountsAttempts(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("new", "m1", now), 0)
	_ = memory.Create(ctx, sample("old", "m1", now.Add(-time.Hour)), 0)

	first, err := memory.Claim(ctx, now, Lease)

	if err != nil || first.ID != "old" || first.Status != StatusRunning || first.Attempts != 1 {
		t.Fatalf("claim = %+v, %v", first, err)
	}
	second, _ := memory.Claim(ctx, now, Lease)
	if second.ID != "new" {
		t.Errorf("second = %+v", second)
	}
	if _, err := memory.Claim(ctx, now, Lease); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty queue: %v", err)
	}
}

func TestAnExpiredLeaseGivesTheItemBackUntilTheAttemptsRunOut(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	start := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", start), 0)

	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		claimed, err := memory.Claim(ctx, start.Add(time.Duration(attempt)*Lease*2), Lease)
		if err != nil || claimed.Attempts != attempt {
			t.Fatalf("attempt %d: %+v, %v", attempt, claimed, err)
		}
	}
	refs, err := memory.Expire(ctx, start.Add(10*Lease), Lease)

	if err != nil || len(refs) != 1 || refs[0] != "m1/a-source.mov" {
		t.Fatalf("expire = %v, %v", refs, err)
	}
	stored, _ := memory.Find(ctx, "a")
	if stored.Status != StatusFailed || stored.Error != DefaultFailReason || stored.SourceRef != "" {
		t.Errorf("stored = %+v", stored)
	}
	if _, err := memory.Claim(ctx, start.Add(11*Lease), Lease); !errors.Is(err, ErrNotFound) {
		t.Errorf("a failed item must not come back: %v", err)
	}
}

func TestFailRequeuesUntilTheLastAttemptOrFinal(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", now), 0)
	_, _ = memory.Claim(ctx, now, Lease)

	ref, err := memory.Fail(ctx, "a", "сбой", false, now)
	if err != nil || ref != "" {
		t.Fatalf("soft fail = %q, %v", ref, err)
	}
	if stored, _ := memory.Find(ctx, "a"); stored.Status != StatusQueued || stored.SourceRef == "" {
		t.Errorf("after a soft fail = %+v", stored)
	}
	_, _ = memory.Claim(ctx, now, Lease)
	ref, err = memory.Fail(ctx, "a", "всё", true, now)
	if err != nil || ref != "m1/a-source.mov" {
		t.Fatalf("final fail = %q, %v", ref, err)
	}
	if stored, _ := memory.Find(ctx, "a"); stored.Status != StatusFailed || stored.Error != "всё" {
		t.Errorf("after a final fail = %+v", stored)
	}
	if _, err := memory.Fail(ctx, "a", "ещё", false, now); !errors.Is(err, ErrState) {
		t.Errorf("fail of a finished item: %v", err)
	}
	if _, err := memory.Fail(ctx, "nope", "x", false, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("fail of a missing item: %v", err)
	}
}

func TestCompleteMovesToDoneAndKeepsTheSourceForARedo(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", now), 0)

	if err := memory.Complete(ctx, "a", Result{}, "r", "t", now); !errors.Is(err, ErrState) {
		t.Errorf("complete of a queued item: %v", err)
	}
	_, _ = memory.Claim(ctx, now, Lease)
	err := memory.Complete(ctx, "a", Result{Type: ResultVideoType, Size: 5}, "m1/a-result.mp4", "m1/a-thumb.jpg", now)

	if err != nil {
		t.Fatalf("complete = %v", err)
	}
	stored, _ := memory.Find(ctx, "a")
	if stored.Status != StatusDone || stored.ResultRef != "m1/a-result.mp4" || stored.SourceRef != "m1/a-source.mov" || stored.Source.Name != "a.mov" {
		t.Errorf("stored = %+v", stored)
	}
	active, done, _ := memory.Remaining(ctx, "m1")
	if active != 0 || done != 1 {
		t.Errorf("remaining = %d, %d", active, done)
	}
}

func TestGetAndRemoveAreScopedToTheMaster(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	_ = memory.Create(ctx, sample("a", "m1", time.Now()), 0)

	if _, err := memory.Get(ctx, "m2", "a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("get by another master: %v", err)
	}
	if _, err := memory.Remove(ctx, "m2", "a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("remove by another master: %v", err)
	}
	if removed, err := memory.Remove(ctx, "m1", "a"); err != nil || removed.ID != "a" {
		t.Errorf("remove = %+v, %v", removed, err)
	}
}

func TestPurgeDropsOnlyOldFinishedItems(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	old := sample("old", "m1", now.AddDate(0, 0, -40))
	old.Status, old.FinishedAt, old.ResultRef, old.ThumbRef, old.SourceRef = StatusDone, now.AddDate(0, 0, -40), "r", "t", ""
	recent := sample("recent", "m1", now.AddDate(0, 0, -2))
	recent.Status, recent.FinishedAt = StatusDone, now.AddDate(0, 0, -2)
	waiting := sample("waiting", "m1", now.AddDate(0, 0, -50))
	for _, item := range []Item{old, recent, waiting} {
		_ = memory.Create(ctx, item, 0)
	}

	refs, err := memory.Purge(ctx, now.AddDate(0, 0, -30))

	if err != nil || strings.Join(refs, ",") != "r,t" {
		t.Fatalf("purge = %v, %v", refs, err)
	}
	items, _ := memory.List(ctx, "m1")
	if len(items) != 2 {
		t.Errorf("left = %+v", items)
	}
}

func TestRecentIsNewestFirstAndLimited(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	for index := range 5 {
		_ = memory.Create(ctx, sample(string(rune('a'+index)), "m1", now.Add(time.Duration(index)*time.Minute)), 0)
	}

	items, _ := memory.Recent(ctx, 2)

	if len(items) != 2 || items[0].ID != "e" || items[1].ID != "d" {
		t.Errorf("recent = %+v", items)
	}
}

func TestMemoryFilesRespectTheLimit(t *testing.T) {
	files := NewMemoryFiles()
	ctx := context.Background()

	if size, err := files.Put(ctx, "m/a.bin", strings.NewReader("hello"), 5); err != nil || size != 5 {
		t.Fatalf("put = %d, %v", size, err)
	}
	if _, err := files.Put(ctx, "m/b.bin", strings.NewReader("hello!"), 5); !errors.Is(err, ErrFileTooLarge) {
		t.Errorf("oversized put: %v", err)
	}
	if files.Has("m/b.bin") {
		t.Error("an oversized file must not be stored")
	}
	if _, size, err := files.Open(ctx, "m/a.bin"); err != nil || size != 5 {
		t.Errorf("open = %d, %v", size, err)
	}
	_ = files.Delete(ctx, "m/a.bin")
	if _, _, err := files.Open(ctx, "m/a.bin"); !errors.Is(err, ErrNoFile) {
		t.Errorf("open after delete: %v", err)
	}
}

func TestRedoQueuesADoneItemAgainWithTheWish(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", now), 0)

	if _, err := memory.Redo(ctx, "m1", "a", "ярче"); !errors.Is(err, ErrState) {
		t.Errorf("redo of a queued item: %v", err)
	}
	_, _ = memory.Claim(ctx, now, Lease)
	_ = memory.Complete(ctx, "a", Result{Type: ResultVideoType}, "m1/a-result.mp4", "", now)
	if _, err := memory.Redo(ctx, "m2", "a", "ярче"); !errors.Is(err, ErrNotFound) {
		t.Errorf("redo by another master: %v", err)
	}

	item, err := memory.Redo(ctx, "m1", "a", "ярче")

	if err != nil || item.Status != StatusQueued || item.Wish != "ярче" || item.Redos != 1 || item.Attempts != 0 || item.ResultRef == "" {
		t.Fatalf("redo = %+v, %v", item, err)
	}
	claimed, _ := memory.Claim(ctx, now, Lease)
	if claimed.ID != "a" || claimed.Wish != "ярче" {
		t.Fatalf("claimed = %+v", claimed)
	}
}

func TestAFailedRedoKeepsThePreviousResult(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", now), 0)
	_, _ = memory.Claim(ctx, now, Lease)
	_ = memory.Complete(ctx, "a", Result{Type: ResultVideoType}, "m1/a-result.mp4", "", now)
	_, _ = memory.Redo(ctx, "m1", "a", "")
	_, _ = memory.Claim(ctx, now, Lease)

	ref, err := memory.Fail(ctx, "a", "ffmpeg упал", true, now)

	stored, _ := memory.Find(ctx, "a")
	if err != nil || ref != "" || stored.Status != StatusDone || stored.ResultRef != "m1/a-result.mp4" ||
		stored.SourceRef == "" || stored.Error != "ffmpeg упал" {
		t.Fatalf("after a failed redo = %+v, ref %q, %v", stored, ref, err)
	}
}

func TestRedoStopsAtTheLimit(t *testing.T) {
	memory := NewMemory()
	ctx := context.Background()
	now := time.Now()
	_ = memory.Create(ctx, sample("a", "m1", now), 0)
	for range MaxRedos + 1 {
		_, _ = memory.Claim(ctx, now, Lease)
		_ = memory.Complete(ctx, "a", Result{Type: ResultVideoType}, "m1/a-result.mp4", "", now)
		_, _ = memory.Redo(ctx, "m1", "a", "")
	}

	if _, err := memory.Redo(ctx, "m1", "a", ""); !errors.Is(err, ErrRedoLimit) {
		t.Fatalf("redo over the limit: %v", err)
	}
}
