package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
)

func TestFramesOfReadsTheFramesOfTheKitFromTheMasterData(t *testing.T) {
	ctx := context.Background()
	people := accounts.NewMemory()
	master, err := people.CreateMaster(ctx, "Анна", "frames-hash")
	if err != nil {
		t.Fatal(err)
	}
	data := json.RawMessage(`{"kits":{"w1-a":{"kit":{"frames":[
		{"visual":"Руки крупно","overlay":"Смотрите"},
		{"visual":"Флакон","overlay":""},
		{"visual":" ","overlay":""}]}}}}`)
	if _, err := people.SaveState(ctx, master.ID, 0, data, time.Now()); err != nil {
		t.Fatal(err)
	}

	frames := framesOf(ctx, people, master.ID, "w1-a")

	if len(frames) != 2 || frames[0] != "Руки крупно Текст на кадре: Смотрите" || frames[1] != "Флакон" {
		t.Fatalf("frames = %q", frames)
	}
	if got := framesOf(ctx, people, master.ID, "no-such"); len(got) != 0 {
		t.Errorf("unknown key = %q", got)
	}
	if got := framesOf(ctx, people, "nobody", "w1-a"); len(got) != 0 {
		t.Errorf("unknown master = %q", got)
	}
}
