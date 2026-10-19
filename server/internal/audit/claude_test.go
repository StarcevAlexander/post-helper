package audit

import (
	"errors"
	"strings"
	"testing"

	"post-helper/server/internal/strategy"
)

const auditJSON = `{"summary":"Профиль аккуратный, но без призыва записаться","strengths":["Единый светлый стиль"],"problems":["В шапке нет ссылки"],"fixes":["Добавьте ссылку для записи","Закрепите три работы"],"bioSuggestion":"Маникюр в Иркутске. Запись по ссылке","nameSuggestion":"Анна | Маникюр Иркутск","contentNotes":["Публикации выходят нерегулярно"],"missing":["Не видно статистики"]}`

func TestParseResult(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "plain json", raw: auditJSON},
		{name: "fenced json", raw: "```json\n" + auditJSON + "\n```"},
		{name: "text around json", raw: "Вот разбор:\n" + auditJSON + "\nГотово."},
		{name: "no json", raw: "просто текст", wantErr: true},
		{name: "empty summary", raw: `{"summary":" ","fixes":["x"]}`, wantErr: true},
		{name: "no fixes", raw: `{"summary":"Ок","fixes":[]}`, wantErr: true},
		{name: "broken json", raw: `{"summary":`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseResult(tt.raw)
			if tt.wantErr {
				if !errors.Is(err, ErrBadAudit) {
					t.Fatalf("err = %v, want ErrBadAudit", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(result.Fixes) != 2 || result.NameSuggestion != "Анна | Маникюр Иркутск" {
				t.Errorf("result = %+v", result)
			}
		})
	}
}

func TestParseResultReportsUnreadableScreenshots(t *testing.T) {
	_, err := parseResult(`{"unreadable":"Скриншоты слишком тёмные, переснимите"}`)

	var unreadable *UnreadableError
	if !errors.As(err, &unreadable) || unreadable.Reason != "Скриншоты слишком тёмные, переснимите" {
		t.Fatalf("err = %v", err)
	}
}

func TestNormalizeCapsAndTrims(t *testing.T) {
	long := strings.Repeat("я", MaxItemRunes+30)
	many := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		many = append(many, "пункт")
	}
	result, err := normalize(Result{
		Summary:        " Итог ",
		Fixes:          append([]string{" ", long}, many...),
		Strengths:      many,
		BioSuggestion:  strings.Repeat("б", MaxBioRunes+5),
		NameSuggestion: " Имя ",
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.Summary != "Итог" || result.NameSuggestion != "Имя" {
		t.Errorf("result = %+v", result)
	}
	if len(result.Fixes) != MaxListItems || len([]rune(result.Fixes[0])) != MaxItemRunes {
		t.Errorf("fixes = %d / %d", len(result.Fixes), len([]rune(result.Fixes[0])))
	}
	if len(result.Strengths) != MaxListItems || len([]rune(result.BioSuggestion)) != MaxBioRunes {
		t.Errorf("result = %+v", result)
	}
	if result.Problems == nil || result.ContentNotes == nil || result.Missing == nil {
		t.Error("lists must not be nil")
	}
}

func TestDescribeRequestCountsImagesAndSkipsTheOldAudit(t *testing.T) {
	text := describeRequest(Request{
		Profile: strategy.Profile{Specialty: "маникюр", City: "Иркутск", Audit: "старый разбор"},
		Images:  []Image{{Name: "a.png"}, {Name: "b.png"}},
	})

	if !strings.Contains(text, "Скриншотов: 2") || !strings.Contains(text, "Иркутск") {
		t.Errorf("text = %s", text)
	}
	if strings.Contains(text, "старый разбор") {
		t.Errorf("the previous audit must not leak into a new one: %s", text)
	}
}

func TestTakesTheLastObject(t *testing.T) {
	second := strings.Replace(auditJSON, "Профиль аккуратный", "Второй вариант", 1)

	result, err := parseResult(`{"summary":"Первый","fixes":["x"]}` + "\nПоправлю:\n" + second)
	if err != nil {
		t.Fatal(err)
	}

	if !strings.HasPrefix(result.Summary, "Второй вариант") {
		t.Errorf("summary = %q", result.Summary)
	}
}
