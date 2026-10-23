package push_test

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/push"
	"post-helper/server/internal/store"
)

func openStores(t *testing.T) (*push.Postgres, *accounts.Postgres) {
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
	return push.NewPostgres(postgres.Pool()), accounts.NewPostgres(postgres.Pool())
}

func TestPostgresSubscriptions(t *testing.T) {
	db, people := openStores(t)
	ctx := context.Background()
	now := time.Now()
	suffix := now.Format("150405.000000000")
	anna, err := people.CreateMaster(ctx, "Тест Анна", "push-hash-a-"+suffix)
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, anna.ID) })
	olga, err := people.CreateMaster(ctx, "Тест Ольга", "push-hash-o-"+suffix)
	if err != nil {
		t.Fatalf("create master: %v", err)
	}
	t.Cleanup(func() { _ = people.DeleteMaster(ctx, olga.ID) })

	for index := range push.MaxSubscriptionsPerMaster + 2 {
		subscription := push.Subscription{
			Endpoint: fmt.Sprintf("https://push.example/%s/%d", suffix, index),
			P256dh:   "key",
			Auth:     "secret",
		}
		if err := db.Save(ctx, anna.ID, subscription, now.Add(time.Duration(index)*time.Second)); err != nil {
			t.Fatalf("save %d: %v", index, err)
		}
	}
	olgaEndpoint := "https://push.example/" + suffix + "/olga"
	if err := db.Save(ctx, olga.ID, push.Subscription{Endpoint: olgaEndpoint, P256dh: "key", Auth: "secret"}, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(ctx, olga.ID, push.Subscription{Endpoint: olgaEndpoint, P256dh: "new-key", Auth: "new-secret"}, now.Add(time.Minute)); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	annaList, err := db.List(ctx, anna.ID)
	if err != nil || len(annaList) != push.MaxSubscriptionsPerMaster {
		t.Fatalf("anna keeps %d, err = %v", len(annaList), err)
	}
	if want := fmt.Sprintf("https://push.example/%s/%d", suffix, push.MaxSubscriptionsPerMaster+1); annaList[0].Endpoint != want {
		t.Errorf("newest first: got %s, want %s", annaList[0].Endpoint, want)
	}
	olgaList, _ := db.List(ctx, olga.ID)
	if len(olgaList) != 1 || olgaList[0].P256dh != "new-key" {
		t.Errorf("upsert must replace keys: %+v", olgaList)
	}

	if err := db.Remove(ctx, anna.ID, olgaEndpoint); err != nil {
		t.Fatal(err)
	}
	if list, _ := db.List(ctx, olga.ID); len(list) != 1 {
		t.Error("another master must not remove the subscription")
	}
	if err := db.RemoveEndpoint(ctx, olgaEndpoint); err != nil {
		t.Fatal(err)
	}
	if list, _ := db.List(ctx, olga.ID); len(list) != 0 {
		t.Error("RemoveEndpoint must delete it")
	}

	if err := people.DeleteMaster(ctx, anna.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := db.List(ctx, anna.ID); len(list) != 0 {
		t.Error("deleting a master must delete their subscriptions")
	}
}
