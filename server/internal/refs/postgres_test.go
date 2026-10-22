package refs_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/store"
)

func openStores(t *testing.T) (*refs.Postgres, *accounts.Postgres) {
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
	return refs.NewPostgres(postgres.Pool()), accounts.NewPostgres(postgres.Pool())
}

func day(offset int) string {
	return time.Now().AddDate(0, 0, offset).Format(refs.DateLayout)
}

func TestPostgresReferencesLifecycle(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now()
	master, err := people.CreateMaster(ctx, "Тест", "refs-hash-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })

	added, removed, err := db.Sync(ctx, master.ID, []refs.OrderItem{
		{Key: "old", Format: refs.FormatPost, Pillar: "p", Idea: "i", Date: day(-10)},
		{Key: "new", Format: refs.FormatReels, Pillar: "p", Idea: "j", Date: day(3)},
	}, now)
	if err != nil || added != 2 || removed != 0 {
		t.Fatalf("sync = %d, %d, %v", added, removed, err)
	}
	if added, removed, err = db.Sync(ctx, master.ID, []refs.OrderItem{
		{Key: "old", Format: refs.FormatPost, Pillar: "p", Idea: "i", Date: day(-10)},
		{Key: "new", Format: refs.FormatReels, Pillar: "p", Idea: "j", Date: day(4)},
	}, now); err != nil || added != 0 || removed != 0 {
		t.Fatalf("a changed date alone must not restart the item: %d, %d, %v", added, removed, err)
	}

	first, err := db.Claim(ctx, now, refs.Lease)
	if err != nil || first.Key != "new" && first.Key != "old" {
		t.Fatalf("claim = %+v, %v", first, err)
	}
	if err := db.Complete(ctx, first.ID, []refs.File{
		{Index: 0, Kind: refs.KindPhoto, MediaType: "image/png", Caption: "один", Data: []byte{1, 2, 3}},
		{Index: 1, Kind: refs.KindPhoto, MediaType: "image/png", Caption: "два", Data: []byte{4, 5}},
	}, now); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if err := db.Complete(ctx, first.ID, nil, now); !errors.Is(err, refs.ErrState) {
		t.Errorf("a second completion must be refused, err = %v", err)
	}

	statuses, err := db.Statuses(ctx, master.ID, now)
	if err != nil || len(statuses) != 2 {
		t.Fatalf("statuses = %+v, %v", statuses, err)
	}
	var done refs.Status
	for _, status := range statuses {
		if status.Key == first.Key {
			done = status
		}
	}
	if done.Status != refs.StatusDone || len(done.Files) != 2 || done.Files[1].Caption != "два" || done.Files[0].Size != 3 {
		t.Errorf("done = %+v", done)
	}
	file, err := db.File(ctx, master.ID, done.Files[0].ID)
	if err != nil || len(file.Data) != 3 {
		t.Errorf("file = %+v, %v", file, err)
	}
	if _, err := db.File(ctx, "someone-else", done.Files[0].ID); !errors.Is(err, refs.ErrNotFound) {
		t.Errorf("another master must not see the file, err = %v", err)
	}

	if first.Key == "old" {
		if _, err := db.Claim(ctx, now, refs.Lease); !errors.Is(err, refs.ErrNotFound) {
			t.Fatalf("an overdue finished item must stop new ones, err = %v", err)
		}
		if !done.Stale {
			t.Errorf("the old item must be overdue: %+v", done)
		}
		if err := db.Confirm(ctx, master.ID, "old"); err != nil {
			t.Fatalf("confirm: %v", err)
		}
		if _, err := db.File(ctx, master.ID, done.Files[0].ID); !errors.Is(err, refs.ErrNotFound) {
			t.Errorf("the files must be gone, err = %v", err)
		}
		next, err := db.Claim(ctx, now, refs.Lease)
		if err != nil || next.Key != "new" {
			t.Fatalf("after the confirmation the new item is made: %+v, %v", next, err)
		}
		if err := db.Confirm(ctx, master.ID, "new"); !errors.Is(err, refs.ErrState) {
			t.Errorf("an item being made cannot be confirmed, err = %v", err)
		}
		if err := db.Fail(ctx, next.ID, "нет GPU", true, now); err != nil {
			t.Fatalf("fail: %v", err)
		}
	}
	if err := db.Confirm(ctx, master.ID, "missing"); !errors.Is(err, refs.ErrNotFound) {
		t.Errorf("unknown key, err = %v", err)
	}

	if _, removed, err = db.Sync(ctx, master.ID, nil, now); err != nil || removed != 2 {
		t.Errorf("an empty plan removes everything: %d, %v", removed, err)
	}
}

func TestPostgresOwnerDeliversReferences(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now()
	master, err := people.CreateMaster(ctx, "Тест выдачи", "refs-deliver-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, master.ID) })
	item := refs.OrderItem{Key: "w1-a", Format: refs.FormatPost, Pillar: "p", Idea: "i", Date: day(3)}

	if err := db.Deliver(ctx, master.ID, item, []refs.File{
		{Index: 0, Kind: refs.KindPhoto, MediaType: "image/png", Caption: "один", Data: []byte{1, 2, 3}},
		{Index: 1, Kind: refs.KindPhoto, MediaType: "image/png", Caption: "два", Data: []byte{4}},
	}, now); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if err := db.Deliver(ctx, master.ID, item, []refs.File{
		{Index: 0, Kind: refs.KindPhoto, MediaType: "image/png", Caption: "новый", Data: []byte{9, 9}},
	}, now); err != nil {
		t.Fatalf("redeliver: %v", err)
	}
	if added, removed, err := db.Sync(ctx, master.ID, []refs.OrderItem{item}, now); err != nil || added != 0 || removed != 0 {
		t.Fatalf("the client order must keep a delivered item: %d, %d, %v", added, removed, err)
	}

	statuses, err := db.Statuses(ctx, master.ID, now)
	if err != nil || len(statuses) != 1 {
		t.Fatalf("statuses = %+v, %v", statuses, err)
	}
	if got := statuses[0]; got.Status != refs.StatusDone || len(got.Files) != 1 || got.Files[0].Caption != "новый" || got.Date != item.Date {
		t.Errorf("status = %+v", got)
	}
}

func TestPostgresMasterDeletionTakesTheReferencesAway(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now()
	master, err := people.CreateMaster(ctx, "Тест", "refs-del-"+now.Format("150405.000000000"))
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	if _, _, err := db.Sync(ctx, master.ID, []refs.OrderItem{{Key: "a", Format: refs.FormatPost}}, now); err != nil {
		t.Fatalf("sync: %v", err)
	}

	if err := people.DeleteMaster(ctx, master.ID); err != nil {
		t.Fatalf("delete master: %v", err)
	}

	statuses, err := db.Statuses(ctx, master.ID, now)
	if err != nil || len(statuses) != 0 {
		t.Errorf("statuses = %+v, %v", statuses, err)
	}
}
