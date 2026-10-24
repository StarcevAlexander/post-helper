package refs

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

func planJSON(captions ...string) string {
	items := make([]string, 0, len(captions))
	for index, caption := range captions {
		items = append(items, fmt.Sprintf(`{"prompt":"hands over a table %d","caption":%q}`, index, caption))
	}
	return `{"prompts":[` + strings.Join(items, ",") + `]}`
}

func TestParsePlanKeepsTheDetailedDescription(t *testing.T) {
	long := strings.Repeat("Снимайте сверху при мягком окне. ", 20)

	plan, err := ParsePlan("вот ответ: " + planJSON(long, "Второй кадр", "Третий кадр"))

	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	if len(plan.Prompts) != PerItem {
		t.Fatalf("prompts = %d", len(plan.Prompts))
	}
	if got := plan.Prompts[0].Caption; got != strings.TrimSpace(long) {
		t.Errorf("a description of %d runes was changed to %d runes", utf8.RuneCountInString(long), utf8.RuneCountInString(got))
	}
}

func TestParsePlanCutsAnAbsurdlyLongDescription(t *testing.T) {
	plan, err := ParsePlan(planJSON(strings.Repeat("я", MaxCaptionRunes*3), "Второй", "Третий"))

	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	if got := utf8.RuneCountInString(plan.Prompts[0].Caption); got != MaxCaptionRunes {
		t.Errorf("runes = %d, want %d", got, MaxCaptionRunes)
	}
}

func TestParsePlanNeedsThreePrompts(t *testing.T) {
	for name, raw := range map[string]string{
		"two":     planJSON("a", "b"),
		"empty":   `{"prompts":[]}`,
		"no json": "не получилось",
	} {
		if _, err := ParsePlan(raw); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestReferencesAreAlwaysPhotos(t *testing.T) {
	if strings.Contains(strings.ToLower(SystemPrompt), "видео") {
		t.Error("the prompt for the planner still talks about video")
	}
	text := describeRequest(Request{Item: Item{Format: FormatReels, Pillar: "Процесс", Idea: "Гель-лак"}})
	if !strings.Contains(text, "фото") || strings.Contains(text, "видео") {
		t.Errorf("request = %q", text)
	}
}
