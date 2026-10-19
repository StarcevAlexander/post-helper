package kit

import (
	"errors"
	"strings"
	"testing"

	"post-helper/server/internal/strategy"
)

const reelsJSON = `{"shots":["Снимите руки крупно","Включите дневной свет"],"frames":[{"visual":"Руки с гель-лаком","overlay":"Смотрите, как это делается"},{"visual":"Нанесение цвета","overlay":"Один слой"},{"visual":"Готовый результат","overlay":"Запись в директ"}],"caption":"Показываю, как делаю нюдовый маникюр. Записаться можно в директ.","hashtags":["#маникюр","иркутск","#маникюр","#nails art"],"tip":"Спросите согласие клиента на съёмку"}`

func TestParseKit(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		format  string
		wantErr bool
	}{
		{name: "plain json", raw: reelsJSON, format: FormatReels},
		{name: "fenced json", raw: "```json\n" + reelsJSON + "\n```", format: FormatReels},
		{name: "text around json", raw: "Вот комплект:\n" + reelsJSON + "\nГотово.", format: FormatReels},
		{name: "post accepts the same shape", raw: reelsJSON, format: FormatPost},
		{name: "stories may have no caption", raw: strings.Replace(reelsJSON, `"caption":"Показываю, как делаю нюдовый маникюр. Записаться можно в директ."`, `"caption":""`, 1), format: FormatStories},
		{name: "reels need a caption", raw: strings.Replace(reelsJSON, `"caption":"Показываю, как делаю нюдовый маникюр. Записаться можно в директ."`, `"caption":" "`, 1), format: FormatReels, wantErr: true},
		{name: "no frames", raw: `{"frames":[],"caption":"x"}`, format: FormatPost, wantErr: true},
		{name: "unknown format", raw: reelsJSON, format: "tiktok", wantErr: true},
		{name: "no json", raw: "просто текст", format: FormatReels, wantErr: true},
		{name: "broken json", raw: `{"frames":`, format: FormatReels, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kit, err := parseKit(tt.raw, tt.format)
			if tt.wantErr {
				if !errors.Is(err, ErrBadKit) {
					t.Fatalf("err = %v, want ErrBadKit", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(kit.Frames) != 3 {
				t.Errorf("frames = %d", len(kit.Frames))
			}
		})
	}
}

func TestNormalizeCleansHashtags(t *testing.T) {
	kit, err := parseKit(reelsJSON, FormatReels)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"#маникюр", "#иркутск"}
	if len(kit.Hashtags) != len(want) || kit.Hashtags[0] != want[0] || kit.Hashtags[1] != want[1] {
		t.Errorf("hashtags = %v, want %v", kit.Hashtags, want)
	}
}

func TestNormalizeCapsAndTrims(t *testing.T) {
	long := strings.Repeat("я", MaxCaptionRunes+100)
	frames := make([]Frame, 0, 20)
	for i := 0; i < 20; i++ {
		frames = append(frames, Frame{Visual: strings.Repeat("в", MaxVisualRunes+50), Overlay: " текст "})
	}
	tags := make([]string, 0, 30)
	for i := 0; i < 30; i++ {
		tags = append(tags, "#тег"+strings.Repeat("а", i))
	}
	input := Kit{
		Shots:    append([]string{"  "}, make([]string, 20)...),
		Frames:   append([]Frame{{}}, frames...),
		Caption:  " " + long + " ",
		Hashtags: tags,
		Tip:      strings.Repeat("п", MaxTipRunes+10),
	}

	kit, err := normalize(input, FormatStories)
	if err != nil {
		t.Fatal(err)
	}

	if len(kit.Frames) != FrameLimits[FormatStories].Max {
		t.Errorf("frames = %d", len(kit.Frames))
	}
	if got := len([]rune(kit.Frames[0].Visual)); got != MaxVisualRunes {
		t.Errorf("visual runes = %d", got)
	}
	if kit.Frames[0].Overlay != "текст" {
		t.Errorf("overlay = %q", kit.Frames[0].Overlay)
	}
	if got := len([]rune(kit.Caption)); got != MaxCaptionRunes {
		t.Errorf("caption runes = %d", got)
	}
	if len(kit.Hashtags) > MaxHashtags {
		t.Errorf("hashtags = %d", len(kit.Hashtags))
	}
	if len(kit.Shots) != 0 {
		t.Errorf("shots = %v", kit.Shots)
	}
	if kit.Shots == nil || kit.Hashtags == nil {
		t.Error("lists must not be nil")
	}
}

func TestTakesTheLastObject(t *testing.T) {
	second := strings.Replace(reelsJSON, "Показываю", "Второй вариант", 1)

	kit, err := parseKit(`{"frames":[{"visual":"a","overlay":"b"}],"caption":"Первый"}`+"\nПоправлю:\n"+second, FormatReels)
	if err != nil {
		t.Fatal(err)
	}

	if !strings.HasPrefix(kit.Caption, "Второй вариант") {
		t.Errorf("caption = %q", kit.Caption)
	}
}

func TestDescribeRequestCarriesProfileAndPublication(t *testing.T) {
	text := describeRequest(Request{
		Profile:     strategy.Profile{Specialty: "маникюр", City: "Иркутск", Style: "Привет, давайте красиво"},
		Positioning: "Аккуратный маникюр",
		Format:      FormatReels,
		Pillar:      "Процесс",
		Idea:        "Видео снятия гель-лака",
	})

	for _, want := range []string{"маникюр", "Иркутск", "Привет, давайте красиво", "Аккуратный маникюр", "Reels", "Процесс", "Видео снятия гель-лака"} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q: %s", want, text)
		}
	}
}

func TestValidFormat(t *testing.T) {
	for _, format := range []string{FormatReels, FormatPost, FormatStories} {
		if !ValidFormat(format) {
			t.Errorf("%s must be valid", format)
		}
	}
	if ValidFormat("tiktok") || ValidFormat("") {
		t.Error("unknown formats must be invalid")
	}
}
