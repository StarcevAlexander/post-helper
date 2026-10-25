package plan

import (
	"encoding/json"
	"fmt"
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

func sampleReview(id string) *Review {
	return &Review{
		ID: id, From: "2026-10-20", To: "2026-11-16", Planned: 16, Done: 12,
		Headline:    "Выполнено 12 из 16",
		Facts:       []string{"Подписчиков 340, было 310"},
		Conclusions: []string{"Сторис про спину дали больше всего ответов"},
		Changes:     []string{"Добавляем рубрику про осанку"},
		Note:        "Отличный месяц",
	}
}

func TestMergeStoresReviewWithoutTouchingTheRest(t *testing.T) {
	existing := json.RawMessage(`{"calendar":{"startedOn":"2026-10-20"},"kits":{}}`)

	merged, err := Merge(existing, Submission{Review: sampleReview("m1")})

	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	state := decode(t, merged.Data)
	var reviews []Review
	if err := json.Unmarshal(state["monthReviews"], &reviews); err != nil || len(reviews) != 1 || reviews[0].ID != "m1" {
		t.Fatalf("reviews = %s, err = %v", state["monthReviews"], err)
	}
	if _, ok := state["calendar"]; !ok {
		t.Error("calendar was lost")
	}
}

func TestMergeReplacesReviewWithTheSameIDAndKeepsOthers(t *testing.T) {
	first, err := Merge(nil, Submission{Review: sampleReview("m1")})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := Merge(first.Data, Submission{Review: sampleReview("m2")})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	updated := sampleReview("m1")
	updated.Headline = "Новый заголовок"
	third, err := Merge(second.Data, Submission{Review: updated})
	if err != nil {
		t.Fatalf("third: %v", err)
	}

	var reviews []Review
	if err := json.Unmarshal(decode(t, third.Data)["monthReviews"], &reviews); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(reviews) != 2 || reviews[0].ID != "m2" || reviews[1].ID != "m1" || reviews[1].Headline != "Новый заголовок" {
		t.Fatalf("reviews = %+v", reviews)
	}
}

func TestMergeKeepsOnlyTheLatestReviews(t *testing.T) {
	var data json.RawMessage
	for index := 0; index < MaxReviews+3; index++ {
		merged, err := Merge(data, Submission{Review: sampleReview(fmt.Sprintf("m%d", index))})
		if err != nil {
			t.Fatalf("merge %d: %v", index, err)
		}
		data = merged.Data
	}

	var reviews []Review
	if err := json.Unmarshal(decode(t, data)["monthReviews"], &reviews); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(reviews) != MaxReviews || reviews[0].ID != "m3" {
		t.Fatalf("len = %d, first = %s", len(reviews), reviews[0].ID)
	}
}

func TestMergeRejectsBadReviews(t *testing.T) {
	doneTooMany := sampleReview("m1")
	doneTooMany.Done = 99
	backwards := sampleReview("m1")
	backwards.From, backwards.To = "2026-11-16", "2026-10-20"
	badDate := sampleReview("m1")
	badDate.From = "20.10.2026"
	noID := sampleReview(" ")
	noHeadline := sampleReview("m1")
	noHeadline.Headline = " "
	noConclusions := sampleReview("m1")
	noConclusions.Conclusions = nil

	cases := map[string]*Review{
		"done above planned": doneTooMany,
		"backwards period":   backwards,
		"bad date":           badDate,
		"no id":              noID,
		"no headline":        noHeadline,
		"no conclusions":     noConclusions,
	}
	for name, review := range cases {
		if _, err := Merge(nil, Submission{Review: review}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func sampleRecommendations() []Recommendation {
	return []Recommendation{
		{ID: "r1", Text: "Добавить запись в шапку", Importance: 90},
		{ID: "r2", Text: "Обновить аватар", Importance: 40},
	}
}

func storedRecommendations(t *testing.T, data json.RawMessage) []Recommendation {
	t.Helper()
	var recommendations []Recommendation
	if err := json.Unmarshal(decode(t, data)["recommendations"], &recommendations); err != nil {
		t.Fatalf("recommendations: %v", err)
	}
	return recommendations
}

func TestMergeStoresRecommendationsWithoutTouchingTheRest(t *testing.T) {
	existing := json.RawMessage(`{"calendar":{"startedOn":"2026-10-20"}}`)

	merged, err := Merge(existing, Submission{Recommendations: sampleRecommendations()})

	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	got := storedRecommendations(t, merged.Data)
	if len(got) != 2 || got[0].ID != "r1" || got[0].Importance != 90 || got[0].Done {
		t.Fatalf("recommendations = %+v", got)
	}
	if _, ok := decode(t, merged.Data)["calendar"]; !ok {
		t.Error("calendar was lost")
	}
}

func TestMergeKeepsTheDoneMarksOfRecommendationsThatStay(t *testing.T) {
	existing := json.RawMessage(`{"recommendations":[{"id":"r1","text":"старое","importance":10,"done":true},{"id":"r9","text":"ушло","importance":5,"done":true}]}`)

	merged, err := Merge(existing, Submission{Recommendations: sampleRecommendations()})

	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	got := storedRecommendations(t, merged.Data)
	if len(got) != 2 || !got[0].Done || got[0].Text != "Добавить запись в шапку" || got[1].Done {
		t.Fatalf("recommendations = %+v", got)
	}
}

func TestMergeClearsRecommendationsWithAnEmptyList(t *testing.T) {
	existing := json.RawMessage(`{"recommendations":[{"id":"r1","text":"x","importance":10,"done":false}]}`)

	merged, err := Merge(existing, Submission{Recommendations: []Recommendation{}})

	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if got := storedRecommendations(t, merged.Data); len(got) != 0 {
		t.Fatalf("recommendations = %+v", got)
	}
}

func TestMergeRejectsBadRecommendations(t *testing.T) {
	tooMany := make([]Recommendation, MaxRecommendations+1)
	for index := range tooMany {
		tooMany[index] = Recommendation{ID: fmt.Sprintf("r%d", index), Text: "x", Importance: 1}
	}
	cases := map[string][]Recommendation{
		"no id":          {{ID: " ", Text: "x", Importance: 10}},
		"duplicate id":   {{ID: "a", Text: "x", Importance: 10}, {ID: "a", Text: "y", Importance: 20}},
		"no text":        {{ID: "a", Text: " ", Importance: 10}},
		"negative":       {{ID: "a", Text: "x", Importance: -1}},
		"above hundred":  {{ID: "a", Text: "x", Importance: 101}},
		"too long":       {{ID: "a", Text: strings.Repeat("я", MaxTextRunes+1), Importance: 10}},
		"too many items": tooMany,
	}
	for name, recommendations := range cases {
		if _, err := Merge(nil, Submission{Recommendations: recommendations}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSubmissionCarriesPlan(t *testing.T) {
	tests := []struct {
		name       string
		submission Submission
		want       bool
	}{
		{"empty", Submission{}, false},
		{"location only", Submission{Location: &Place{City: "Казань"}}, false},
		{"recommendations only", Submission{Recommendations: []Recommendation{}}, false},
		{"note only", Submission{Note: "привет"}, false},
		{"strategy", Submission{Strategy: &Strategy{}}, true},
		{"calendar", Submission{Calendar: &Calendar{}}, true},
		{"kits", Submission{Kits: map[string]Kit{"a": {}}}, true},
		{"review", Submission{Review: &Review{}}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.submission.CarriesPlan(); got != tt.want {
				t.Errorf("CarriesPlan = %v, want %v", got, tt.want)
			}
		})
	}
}
