package media

import (
	"strings"
	"testing"
	"unicode/utf8"
)

var spoken = []Segment{{Start: 0, End: 2.4, Text: "привет"}, {Start: 2.4, End: 5, Text: "сегодня снимаю"}}

func TestParsePlanAcceptsAValidAnswerAroundOtherText(t *testing.T) {
	raw := "Вот план:\n" + `{"preset":"Warm","focus":"top","title":"До и после","subtitles":[{"start":0,"end":2.4,"text":"Привет!"},{"start":2.4,"end":5,"text":"Сегодня снимаю"}],"note":"Добавил тепла"}`

	plan, err := ParsePlan(raw, spoken)

	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	if plan.Preset != PresetWarm || plan.Focus != FocusTop || plan.Title != "До и после" || plan.Note != "Добавил тепла" || plan.Source != PlanSourceClaude {
		t.Errorf("plan = %+v", plan)
	}
	if len(plan.Subtitles) != 2 || plan.Subtitles[0].Text != "Привет!" {
		t.Errorf("subtitles = %+v", plan.Subtitles)
	}
}

func TestParsePlanCutsLongTextsAndFillsTheNote(t *testing.T) {
	long := strings.Repeat("я", MaxSubtitleRunes*2)
	raw := `{"preset":"clean","focus":"center","title":"` + strings.Repeat("т", 90) + `","subtitles":[{"start":0,"end":2,"text":"` + long + `"}]}`

	plan, err := ParsePlan(raw, spoken)

	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	if utf8.RuneCountInString(plan.Title) != MaxTitleRunes || utf8.RuneCountInString(plan.Subtitles[0].Text) != MaxSubtitleRunes {
		t.Errorf("title %d, subtitle %d", utf8.RuneCountInString(plan.Title), utf8.RuneCountInString(plan.Subtitles[0].Text))
	}
	if plan.Note != DefaultNote {
		t.Errorf("note = %q", plan.Note)
	}
}

func TestParsePlanRejectsGarbage(t *testing.T) {
	tests := map[string]string{
		"no json":        "не получилось",
		"unknown preset": `{"preset":"neon","focus":"center","subtitles":[{"start":0,"end":2,"text":"a"}]}`,
		"unknown focus":  `{"preset":"warm","focus":"left","subtitles":[{"start":0,"end":2,"text":"a"}]}`,
		"negative start": `{"preset":"warm","focus":"top","subtitles":[{"start":-1,"end":2,"text":"a"}]}`,
		"end not later":  `{"preset":"warm","focus":"top","subtitles":[{"start":2,"end":2,"text":"a"}]}`,
		"outside speech": `{"preset":"warm","focus":"top","subtitles":[{"start":30,"end":32,"text":"a"}]}`,
		"lost all text":  `{"preset":"warm","focus":"top","subtitles":[]}`,
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := ParsePlan(raw, spoken); err == nil {
				t.Error("accepted")
			}
		})
	}
}

func TestParsePlanForSilentFileKeepsNoSubtitles(t *testing.T) {
	plan, err := ParsePlan(`{"preset":"soft","focus":"bottom","title":"","subtitles":[],"note":"ok"}`, nil)

	if err != nil || len(plan.Subtitles) != 0 || plan.Preset != PresetSoft {
		t.Fatalf("plan = %+v, %v", plan, err)
	}
	if _, err := ParsePlan(`{"preset":"soft","focus":"bottom","subtitles":[{"start":0,"end":1,"text":"выдумка"}]}`, nil); err == nil {
		t.Error("invented subtitles of a silent file were accepted")
	}
}

func TestDefaultPlanCleansTheSegments(t *testing.T) {
	segments := []Segment{
		{Start: 0, End: 1, Text: "  привет  "},
		{Start: 1, End: 2, Text: "   "},
		{Start: 3, End: 2, Text: "обратный"},
		{Start: -1, End: 2, Text: "минус"},
		{Start: 4, End: 5, Text: strings.Repeat("я", MaxSubtitleRunes+50)},
	}

	plan := DefaultPlan(segments, "")

	if plan.Preset != PresetClean || plan.Focus != FocusCenter || plan.Title != "" || plan.Note != DefaultNote || plan.Source != PlanSourceDefault {
		t.Errorf("plan = %+v", plan)
	}
	if len(plan.Subtitles) != 2 || plan.Subtitles[0].Text != "привет" || utf8.RuneCountInString(plan.Subtitles[1].Text) != MaxSubtitleRunes {
		t.Errorf("subtitles = %+v", plan.Subtitles)
	}
}

func TestDefaultPlanKeepsAtMostFourHundredSegments(t *testing.T) {
	segments := make([]Segment, 500)
	for index := range segments {
		segments[index] = Segment{Start: float64(index), End: float64(index) + 1, Text: "слово"}
	}

	if got := len(DefaultPlan(segments, "").Subtitles); got != MaxSegments {
		t.Errorf("segments = %d", got)
	}
}

func TestResolveTypeUsesTheHeaderThenTheExtension(t *testing.T) {
	tests := []struct{ contentType, name, want string }{
		{"video/mp4", "a.bin", "video/mp4"},
		{"VIDEO/QuickTime; codecs=x", "a.mov", "video/quicktime"},
		{"", "IMG_1.HEIC", "image/heic"},
		{"application/octet-stream", "clip.MOV", "video/quicktime"},
		{"application/octet-stream", "clip.xyz", ""},
		{"text/plain", "a.jpg", "text/plain"},
	}
	for _, test := range tests {
		if got := ResolveType(test.contentType, test.name); got != test.want {
			t.Errorf("ResolveType(%q, %q) = %q, want %q", test.contentType, test.name, got, test.want)
		}
	}
	if _, ok := KindOf("text/plain"); ok {
		t.Error("text/plain is not a media type")
	}
	if kind, _ := KindOf("video/3gpp"); kind != KindVideo {
		t.Errorf("3gpp kind = %q", kind)
	}
}

func TestDescribeRequestShowsWhatClaudeNeeds(t *testing.T) {
	text := describeRequest(Request{
		About: "Сведения о мастере:\nИмя: Анна\n",
		Item:  Item{Kind: KindVideo, Format: FormatReels, Pillar: "Процесс", Idea: "Снятие гель-лака", Overlay: "До и после"},
		Width: 1920, Height: 1080, DurationMs: 14800, Segments: spoken,
	})

	for _, want := range []string{"Анна", "reels", "Процесс", "Снятие гель-лака", "До и после", "видео, 1920×1080, 14.8 с", "[0.00 - 2.40] привет"} {
		if !strings.Contains(text, want) {
			t.Errorf("request lacks %q:\n%s", want, text)
		}
	}
	silent := describeRequest(Request{Item: Item{Kind: KindPhoto}, Width: 100, Height: 100})
	if !strings.Contains(silent, "Речи в файле нет") || !strings.Contains(silent, "фото") {
		t.Errorf("silent = %s", silent)
	}
}

func TestParsePlanKeepsAndCutsTheCaption(t *testing.T) {
	plan, err := ParsePlan(`{"preset":"clean","focus":"center","subtitles":[],"caption":"  `+strings.Repeat("я", MaxCaptionRunes+10)+`"}`, nil)

	if err != nil || utf8.RuneCountInString(plan.Caption) != MaxCaptionRunes {
		t.Fatalf("caption %d runes, %v", utf8.RuneCountInString(plan.Caption), err)
	}
}

func TestDefaultPlanTakesTheMasterNoteAsIs(t *testing.T) {
	if got := DefaultPlan(nil, "  мой текст  ").Caption; got != "мой текст" {
		t.Errorf("caption = %q", got)
	}
	if got := utf8.RuneCountInString(DefaultPlan(nil, strings.Repeat("я", 1000)).Caption); got != MaxCaptionRunes {
		t.Errorf("long note = %d", got)
	}
}

func TestRequestShowsTheMasterNoteOrSaysThereIsNone(t *testing.T) {
	with := describeRequest(Request{Item: Item{Note: "Записывайтесь на гель-лак"}})
	without := describeRequest(Request{Item: Item{}})

	if !strings.Contains(with, "Записывайтесь на гель-лак") || strings.Contains(with, "Текста мастера нет") {
		t.Errorf("with = %s", with)
	}
	if !strings.Contains(without, "Текста мастера нет") {
		t.Errorf("without = %s", without)
	}
}

func TestAWishMayDropTheSubtitles(t *testing.T) {
	raw := `{"preset":"bright","focus":"center","title":"","subtitles":[],"note":"Убрал субтитры"}`
	spoken := []Segment{{Start: 0, End: 2, Text: "привет"}}

	if _, err := parseFor(raw, Request{Segments: spoken}); err == nil {
		t.Error("without a wish the speech must stay in the subtitles")
	}
	plan, err := parseFor(raw, Request{Segments: spoken, Item: Item{Wish: "без субтитров"}})
	if err != nil || len(plan.Subtitles) != 0 || plan.Preset != PresetBright {
		t.Fatalf("plan = %+v, %v", plan, err)
	}
}

func TestTheWishGoesIntoTheRequest(t *testing.T) {
	text := describeRequest(Request{Item: Item{Kind: KindVideo, Wish: "ярче"}})
	if !strings.Contains(text, "просит переделать: ярче") {
		t.Errorf("request = %s", text)
	}
	if text := describeRequest(Request{Item: Item{Kind: KindVideo, Redos: 1}}); !strings.Contains(text, "без пояснений") {
		t.Errorf("request without a wish = %s", text)
	}
}
