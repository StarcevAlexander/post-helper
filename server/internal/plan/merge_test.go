package plan

import (
	"encoding/json"
	"strings"
	"testing"
)

func sampleStrategy() *Strategy {
	return &Strategy{
		Summary: "Эксперт по окрашиванию", Positioning: "Блонд без желтизны",
		ProfileFixes: []string{"Добавить запись в шапку"},
		Pillars:      []Pillar{{Title: "Процесс", Description: "Съёмка работы", Ideas: []string{"Тонирование за 60 секунд"}}},
		Cadence:      Cadence{Reels: 2, Posts: 1, Stories: 4, Note: "по будням"},
		FirstSteps:   []string{"Обновить аватар"},
	}
}

func sampleCalendar() *Calendar {
	return &Calendar{
		StartedOn: "2026-10-23",
		Schedule:  Schedule{Slots: []Slot{{Weekday: 1, Time: "11:00"}}, PublishTime: "19:00"},
		Items: []Item{
			{ID: "w1-a", Date: "2026-10-26", Time: "19:00", Format: "reels", Pillar: "Процесс", Idea: "Тонирование за 60 секунд"},
			{ID: "w1-b", Date: "2026-10-28", Time: "19:00", Format: "post", Pillar: "Процесс", Idea: "До и после"},
		},
	}
}

func decode(t *testing.T, data json.RawMessage) map[string]json.RawMessage {
	t.Helper()
	var out map[string]json.RawMessage
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func TestMergeKeepsOtherStateKeys(t *testing.T) {
	existing := json.RawMessage(`{"chat":[{"id":"1"}],"onboarding":{"index":2}}`)

	merged, err := Merge(existing, Submission{Strategy: sampleStrategy(), Calendar: sampleCalendar()})

	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	state := decode(t, merged.Data)
	for _, key := range []string{"chat", "onboarding", "strategy", "calendar", "kits"} {
		if _, ok := state[key]; !ok {
			t.Errorf("state lacks %q", key)
		}
	}
	if len(merged.Items) != 2 {
		t.Errorf("items = %d", len(merged.Items))
	}
}

func TestMergeKeepsDoneFlagsOfSurvivingItems(t *testing.T) {
	first, err := Merge(nil, Submission{Calendar: sampleCalendar()})
	if err != nil {
		t.Fatal(err)
	}
	var stored Calendar
	_ = json.Unmarshal(decode(t, first.Data)["calendar"], &stored)
	stored.Items[0].Done = true
	raw, _ := json.Marshal(map[string]any{"calendar": stored})

	next := sampleCalendar()
	next.Items = append(next.Items, Item{ID: "w2-a", Date: "2026-11-02", Time: "19:00", Format: "stories", Pillar: "Жизнь", Idea: "Рабочий день"})
	merged, err := Merge(raw, Submission{Calendar: next})
	if err != nil {
		t.Fatal(err)
	}

	if !merged.Items[0].Done || merged.Items[1].Done || merged.Items[2].Done {
		t.Errorf("done flags = %v %v %v", merged.Items[0].Done, merged.Items[1].Done, merged.Items[2].Done)
	}
}

func TestMergeBindsKitsToCalendarItems(t *testing.T) {
	kit := Kit{Shots: []string{"Крупно руки"}, Caption: "Подпись", Hashtags: []string{"#блонд"}, Tip: "Свет у окна",
		Frames: []Frame{{Visual: "До", Overlay: "Было"}}}

	merged, err := Merge(nil, Submission{Calendar: sampleCalendar(), Kits: map[string]Kit{"w1-a": kit}})

	if err != nil {
		t.Fatal(err)
	}
	var kits map[string]StoredKit
	_ = json.Unmarshal(decode(t, merged.Data)["kits"], &kits)
	entry := kits["w1-a"]
	if entry.ItemID != "w1-a" || entry.Format != "reels" || entry.Idea != "Тонирование за 60 секунд" || entry.Kit.Caption != "Подпись" {
		t.Errorf("entry = %+v", entry)
	}
}

func TestMergeDropsKitsOfRemovedItems(t *testing.T) {
	first, _ := Merge(nil, Submission{Calendar: sampleCalendar(), Kits: map[string]Kit{"w1-a": {Caption: "x"}, "w1-b": {Caption: "y"}}})
	shrunk := sampleCalendar()
	shrunk.Items = shrunk.Items[:1]

	merged, err := Merge(first.Data, Submission{Calendar: shrunk})

	if err != nil {
		t.Fatal(err)
	}
	var kits map[string]StoredKit
	_ = json.Unmarshal(decode(t, merged.Data)["kits"], &kits)
	if _, ok := kits["w1-a"]; !ok || len(kits) != 1 {
		t.Errorf("kits = %v", kits)
	}
}

func TestMergeRejectsBadPlans(t *testing.T) {
	badFormat := sampleCalendar()
	badFormat.Items[0].Format = "podcast"
	badDate := sampleCalendar()
	badDate.Items[0].Date = "26.10.2026"
	duplicate := sampleCalendar()
	duplicate.Items[1].ID = duplicate.Items[0].ID
	noPillars := sampleStrategy()
	noPillars.Pillars = nil
	noSummary := sampleStrategy()
	noSummary.Summary = " "

	cases := map[string]Submission{
		"empty":         {},
		"bad format":    {Calendar: badFormat},
		"bad date":      {Calendar: badDate},
		"duplicate id":  {Calendar: duplicate},
		"no pillars":    {Strategy: noPillars},
		"no summary":    {Strategy: noSummary},
		"kits no cal":   {Kits: map[string]Kit{"x": {}}},
		"kit unknown":   {Calendar: sampleCalendar(), Kits: map[string]Kit{"zzz": {}}},
		"note too long": {Strategy: sampleStrategy(), Note: strings.Repeat("я", MaxNoteRunes+1)},
	}
	for name, submission := range cases {
		if _, err := Merge(nil, submission); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
