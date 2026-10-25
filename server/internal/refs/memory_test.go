package refs

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMemoryDeliverKeepsMadeAndRunningItems(t *testing.T) {
	order := OrderItem{Key: "w1-a", Format: FormatPost, Pillar: "Работы", Idea: "Идея", Date: "2026-10-26"}
	files := []File{{Index: 0, Kind: KindPhoto, MediaType: "image/png", Data: []byte("png")}}
	tests := []struct {
		name    string
		prepare func(t *testing.T, store *Memory, masterID string)
		wantErr error
		want    string
	}{
		{"new item", func(*testing.T, *Memory, string) {}, nil, StatusDone},
		{"queued item", func(t *testing.T, store *Memory, masterID string) {
			if _, _, err := store.Sync(context.Background(), masterID, []OrderItem{order}, time.Now()); err != nil {
				t.Fatal(err)
			}
		}, nil, StatusDone},
		{"running item", func(t *testing.T, store *Memory, masterID string) {
			if _, _, err := store.Sync(context.Background(), masterID, []OrderItem{order}, time.Now()); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Claim(context.Background(), time.Now(), Lease); err != nil {
				t.Fatal(err)
			}
		}, ErrState, StatusRunning},
		{"made item", func(t *testing.T, store *Memory, masterID string) {
			if err := store.Deliver(context.Background(), masterID, order, files, time.Now()); err != nil {
				t.Fatal(err)
			}
			if err := store.Confirm(context.Background(), masterID, order.Key); err != nil {
				t.Fatal(err)
			}
		}, ErrState, StatusMade},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := NewMemory()
			tt.prepare(t, store, "anna")

			err := store.Deliver(context.Background(), "anna", order, files, time.Now())

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			statuses, _ := store.Statuses(context.Background(), "anna", time.Now())
			if len(statuses) != 1 || statuses[0].Status != tt.want {
				t.Errorf("statuses = %+v, want status %s", statuses, tt.want)
			}
		})
	}
}
