package review

import (
	"errors"
	"strings"
	"testing"

	"post-helper/server/internal/strategy"
)

const reviewJSON = `{"headline":"Вы сделали 6 из 9 публикаций, это хороший старт","whatWorked":["Сторис с окошками привели обращения"],"whatToChange":["Снимайте пачкой в день контента"],"nextFocus":"Выложить два Reels","cadence":{"reels":2,"posts":2,"stories":4},"newIdeas":[{"pillar":"Окошки","ideas":["Окошки на выходные","Сторис с прайсом"]}]}`

var previous = strategy.Cadence{Reels: 1, Posts: 1, Stories: 3}

func TestParseReview(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "plain json", raw: reviewJSON},
		{name: "fenced json", raw: "```json\n" + reviewJSON + "\n```"},
		{name: "text around json", raw: "Вот итоги:\n" + reviewJSON + "\nГотово."},
		{name: "no json", raw: "просто текст", wantErr: true},
		{name: "empty headline", raw: `{"headline":" ","whatToChange":["x"]}`, wantErr: true},
		{name: "nothing to change", raw: `{"headline":"Ок","whatToChange":[]}`, wantErr: true},
		{name: "broken json", raw: `{"headline":`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			review, err := parseReview(tt.raw, previous)
			if tt.wantErr {
				if !errors.Is(err, ErrBadReview) {
					t.Fatalf("err = %v, want ErrBadReview", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if review.Cadence.Reels != 2 || len(review.NewIdeas) != 1 {
				t.Errorf("review = %+v", review)
			}
		})
	}
}

func TestNormalizeKeepsThePreviousCadenceWhenTheModelGivesNone(t *testing.T) {
	review, err := parseReview(`{"headline":"Ок","whatToChange":["x"],"cadence":{"reels":0,"posts":0,"stories":0}}`, previous)
	if err != nil {
		t.Fatal(err)
	}

	if review.Cadence != (strategy.Cadence{Reels: 1, Posts: 1, Stories: 3}) {
		t.Errorf("cadence = %+v", review.Cadence)
	}
}

func TestNormalizeCapsAndDropsEmptyGroups(t *testing.T) {
	long := strings.Repeat("я", MaxItemRunes+20)
	input := Review{
		Headline:     " Итог ",
		WhatToChange: []string{" ", long},
		Cadence:      strategy.Cadence{Reels: 99, Posts: -2, Stories: 3},
		NewIdeas: []NewIdeas{
			{Pillar: "А", Ideas: []string{"1", "2", "3", "4", "5", "6", "7"}},
			{Pillar: " ", Ideas: []string{"x"}},
			{Pillar: "Б", Ideas: nil},
			{Pillar: "В", Ideas: []string{"x"}},
			{Pillar: "Г", Ideas: []string{"x"}},
			{Pillar: "Д", Ideas: []string{"x"}},
		},
	}

	review, err := normalize(input, previous)
	if err != nil {
		t.Fatal(err)
	}

	if review.Headline != "Итог" || len(review.WhatToChange) != 1 || len([]rune(review.WhatToChange[0])) != MaxItemRunes {
		t.Errorf("review = %+v", review)
	}
	if len(review.NewIdeas) != MaxNewIdeaPillars || len(review.NewIdeas[0].Ideas) != MaxNewIdeas {
		t.Errorf("newIdeas = %+v", review.NewIdeas)
	}
	if review.Cadence.Reels != MaxPerWeek || review.Cadence.Posts != 0 || review.Cadence.Stories != 3 {
		t.Errorf("cadence = %+v", review.Cadence)
	}
	if review.WhatWorked == nil {
		t.Error("lists must not be nil")
	}
}

func TestDescribeRequestCarriesTheWeek(t *testing.T) {
	inquiries := 4
	text := describeRequest(Request{
		Profile:     strategy.Profile{Specialty: "маникюр", City: "Иркутск"},
		Positioning: "Аккуратный маникюр",
		Cadence:     strategy.Cadence{Reels: 1, Posts: 2, Stories: 5},
		Pillars:     []Pillar{{Title: "Окошки", Ideas: []string{"Свободно в пятницу"}}},
		Items: []Item{
			{Format: "reels", Pillar: "Окошки", Idea: "Видео", Done: true},
			{Format: "post", Pillar: "Окошки", Idea: "Пост", Done: false},
		},
		Results: Results{Inquiries: &inquiries, BestIdea: "Видео", Hard: "нет времени"},
	})

	for _, want := range []string{"маникюр", "Reels 1, посты 2, сторис 5", "Свободно в пятницу", "[сделано] reels", "[не сделано] post", "Выполнено 1 из 2", "Обращений из Instagram за неделю: 4", "Лучше всего сработало: Видео", "нет времени"} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q: %s", want, text)
		}
	}
}

func TestDescribeRequestWhenTheMasterDoesNotKnowTheNumbers(t *testing.T) {
	text := describeRequest(Request{Profile: strategy.Profile{Specialty: "маникюр"}})

	if !strings.Contains(text, "мастер не знает") {
		t.Errorf("text = %s", text)
	}
}
