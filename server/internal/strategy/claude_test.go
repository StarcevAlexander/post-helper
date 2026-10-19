package strategy

import (
	"errors"
	"strings"
	"testing"
)

const validJSON = `{"summary":"Вы мастер маникюра","positioning":"Аккуратный маникюр без спешки","profileFixes":["Добавьте город в имя","Закрепите работы"],"pillars":[{"title":"До и после","description":"Показывает результат","ideas":["Кадр до","Кадр после"]},{"title":"Процесс","description":"Показывает руки за работой","ideas":["Видео шлифовки"]},{"title":"Окошки","description":"Приводит записи","ideas":["Свободно в пятницу"]}],"cadence":{"reels":2,"posts":2,"stories":5,"note":"Лучше мало, но каждую неделю"},"firstSteps":["Поправьте шапку","Снимите три кадра"]}`

func TestParseStrategy(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "plain json", raw: validJSON},
		{name: "fenced json", raw: "```json\n" + validJSON + "\n```"},
		{name: "text around json", raw: "Вот стратегия:\n" + validJSON + "\nГотово."},
		{name: "no json", raw: "просто текст", wantErr: true},
		{name: "empty summary", raw: `{"summary":" ","pillars":[]}`, wantErr: true},
		{name: "too few pillars", raw: `{"summary":"Ок","pillars":[{"title":"Одна","ideas":[]}]}`, wantErr: true},
		{name: "broken json", raw: `{"summary":`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseStrategy(tt.raw)
			if tt.wantErr {
				if !errors.Is(err, ErrBadStrategy) {
					t.Fatalf("err = %v, want ErrBadStrategy", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(result.Pillars) != 3 || result.Cadence.Stories != 5 {
				t.Errorf("result = %+v", result)
			}
		})
	}
}

func TestParseStrategyTakesTheLastObject(t *testing.T) {
	second := strings.Replace(validJSON, "Вы мастер маникюра", "Второй вариант", 1)

	result, err := parseStrategy(`{"summary":"Первый","pillars":[]}` + "\nПоправлю:\n" + second)
	if err != nil {
		t.Fatal(err)
	}

	if result.Summary != "Второй вариант" {
		t.Errorf("summary = %q", result.Summary)
	}
}

func TestNormalizeCapsAndTrims(t *testing.T) {
	long := strings.Repeat("я", MaxItemRunes+50)
	input := Strategy{
		Summary:      " Ок ",
		ProfileFixes: append([]string{"  ", long}, make([]string, 20)...),
		Pillars: []Pillar{
			{Title: "А", Ideas: []string{long, "", "б", "в", "г", "д", "е"}},
			{Title: "Б"}, {Title: "В"}, {Title: "Г"}, {Title: "Д"}, {Title: "Е"},
			{Title: " "},
		},
		Cadence: Cadence{Reels: 99, Posts: -3, Stories: 5},
	}

	result, err := normalize(input)
	if err != nil {
		t.Fatal(err)
	}

	if result.Summary != "Ок" {
		t.Errorf("summary = %q", result.Summary)
	}
	if len(result.Pillars) != MaxPillars {
		t.Errorf("pillars = %d, want %d", len(result.Pillars), MaxPillars)
	}
	if got := len(result.Pillars[0].Ideas); got != MaxIdeas {
		t.Errorf("ideas = %d, want %d", got, MaxIdeas)
	}
	if got := len([]rune(result.Pillars[0].Ideas[0])); got != MaxItemRunes {
		t.Errorf("idea runes = %d, want %d", got, MaxItemRunes)
	}
	if len(result.ProfileFixes) != 1 {
		t.Errorf("profileFixes = %v", result.ProfileFixes)
	}
	if result.Cadence.Reels != MaxPerWeek || result.Cadence.Posts != 0 || result.Cadence.Stories != 5 {
		t.Errorf("cadence = %+v", result.Cadence)
	}
	if result.Pillars[0].Ideas == nil || result.Pillars[1].Ideas == nil {
		t.Error("ideas must be lists, not nil")
	}
}

func TestDescribeProfileSkipsEmptyFields(t *testing.T) {
	text := describeProfile(Profile{Specialty: "маникюр", City: " Иркутск ", Name: ""})

	if !strings.Contains(text, "Чем занимается: маникюр") || !strings.Contains(text, "Город: Иркутск") {
		t.Errorf("text = %q", text)
	}
	if strings.Contains(text, "Имя") || strings.Contains(text, "Опыт") {
		t.Errorf("empty fields leaked: %q", text)
	}
}

func TestParseStrategyReportsInsufficientProfile(t *testing.T) {
	_, err := parseStrategy(`{"insufficient":"Непонятно, чем вы занимаетесь"}`)

	var insufficient *InsufficientError
	if !errors.As(err, &insufficient) {
		t.Fatalf("err = %v, want InsufficientError", err)
	}
	if insufficient.Reason != "Непонятно, чем вы занимаетесь" {
		t.Errorf("reason = %q", insufficient.Reason)
	}
}
