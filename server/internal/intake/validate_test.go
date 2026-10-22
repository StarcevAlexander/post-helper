package intake

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestNormalizeLinkDetectsPlatforms(t *testing.T) {
	cases := map[string]struct{ link, platform string }{
		"instagram.com/anna_nails":         {"https://instagram.com/anna_nails", PlatformInstagram},
		"https://www.instagram.com/a_b/":   {"https://www.instagram.com/a_b/", PlatformInstagram},
		"HTTP://VK.com/anna":               {"https://vk.com/anna", PlatformVK},
		"t.me/anna_master":                 {"https://t.me/anna_master", PlatformTelegram},
		"https://youtube.com/@anna":        {"https://youtube.com/@anna", PlatformYouTube},
		"https://dzen.ru/anna#top":         {"https://dzen.ru/anna", PlatformDzen},
		"https://anna-nails.ru":            {"https://anna-nails.ru", PlatformOther},
		"https://m.vk.com/anna?from=share": {"https://m.vk.com/anna?from=share", PlatformVK},
	}
	for raw, want := range cases {
		link, platform, ok := NormalizeLink(raw)
		if !ok || link != want.link || platform != want.platform {
			t.Errorf("NormalizeLink(%q) = %q, %q, %v; want %q, %q", raw, link, platform, ok, want.link, want.platform)
		}
	}
}

func TestNormalizeLinkRejectsGarbage(t *testing.T) {
	for _, raw := range []string{"", "анна", "anna_nails", "ftp://vk.com/anna", "https://user:pw@vk.com/anna", "vk.com", "https://vk.com/a", "два слова.ru", "javascript:alert(1)"} {
		if link, _, ok := NormalizeLink(raw); ok {
			t.Errorf("NormalizeLink(%q) accepted as %q", raw, link)
		}
	}
}

func TestCleanDedupesAndValidates(t *testing.T) {
	draft, err := Clean([]string{"instagram.com/anna", "https://INSTAGRAM.com/anna", "", "t.me/anna_m"}, nil, []string{"reach", "reach", "leads"}, "  Не люблю танцы в кадре  ")
	if err != nil {
		t.Fatalf("Clean: %v", err)
	}
	if len(draft.Networks) != 2 || len(draft.Goals) != 2 || draft.Note != "Не люблю танцы в кадре" || len(draft.References) != 0 {
		t.Errorf("draft = %+v", draft)
	}
}

func TestCleanReferences(t *testing.T) {
	refs := []string{"vk.com/ref_one", "https://VK.com/ref_one", "", "instagram.com/anna", "t.me/ref_two", "ref-blog.ru"}
	draft, err := Clean([]string{"instagram.com/anna"}, refs, []string{"reach"}, "")
	if err != nil {
		t.Fatalf("Clean: %v", err)
	}
	if len(draft.References) != 3 || draft.References[0].URL != "https://vk.com/ref_one" || draft.References[2].Platform != PlatformOther {
		t.Errorf("references = %+v", draft.References)
	}
	if _, err := Clean([]string{"instagram.com/anna"}, make([]string, MaxReferences+1), []string{"reach"}, ""); !errors.Is(err, ErrTooManyRef) {
		t.Errorf("too many references: err = %v", err)
	}
	if _, err := Clean([]string{"instagram.com/anna"}, []string{"не ссылка"}, []string{"reach"}, ""); !errors.Is(err, ErrBadLink) {
		t.Errorf("bad reference: err = %v", err)
	}
	many := make([]string, 0, 40)
	for index := range 40 {
		many = append(many, fmt.Sprintf("vk.com/ref_%d", index))
	}
	if draft, err := Clean([]string{"instagram.com/anna"}, many, []string{"reach"}, ""); err != nil || len(draft.References) != 40 {
		t.Errorf("many references: %d, %v", len(draft.References), err)
	}
}

func TestCleanErrors(t *testing.T) {
	long := strings.Repeat("я", MaxNoteRunes+1)
	cases := []struct {
		name  string
		links []string
		goals []string
		note  string
		want  error
	}{
		{"no links", nil, []string{"reach"}, "", ErrNoNetworks},
		{"blank links", []string{" ", ""}, []string{"reach"}, "", ErrNoNetworks},
		{"bad link", []string{"anna"}, []string{"reach"}, "", ErrBadLink},
		{"too many", make([]string, MaxNetworks+1), []string{"reach"}, "", ErrTooMany},
		{"no goals", []string{"vk.com/anna"}, nil, "", ErrNoGoals},
		{"unknown goal", []string{"vk.com/anna"}, []string{"magic"}, "", ErrBadGoal},
		{"long note", []string{"vk.com/anna"}, []string{"reach"}, long, ErrLongText},
	}
	for _, tc := range cases {
		if _, err := Clean(tc.links, nil, tc.goals, tc.note); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.want)
		}
	}
}

func TestAnnouncementCarriesWishes(t *testing.T) {
	text := Announcement(Request{
		MasterID:   "m1",
		Networks:   []Network{{Platform: PlatformVK, URL: "https://vk.com/anna"}},
		References: []Network{{Platform: PlatformInstagram, URL: "https://instagram.com/ref_master"}},
		Goals:      []string{"reach", "check"},
		Note:       "Без танцев, больше про окрашивание",
	}, "Анна", false)
	for _, want := range []string{"Референсы", "Instagram: https://instagram.com/ref_master", "Новая заявка", "Анна", "ВКонтакте: https://vk.com/anna", "Увеличить охваты", "Поднять средний чек", "Пожелания и рекомендации", "Без танцев", "m1"} {
		if !strings.Contains(text, want) {
			t.Errorf("announcement lacks %q:\n%s", want, text)
		}
	}
}
