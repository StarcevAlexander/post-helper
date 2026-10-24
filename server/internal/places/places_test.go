package places

import (
	"errors"
	"strings"
	"testing"
)

func TestCleanCityTrimsAndCollapsesSpaces(t *testing.T) {
	city, ok := CleanCity("  Усть   Илимск \n")

	if !ok || city != "Усть Илимск" {
		t.Fatalf("city = %q, ok = %v", city, ok)
	}
}

func TestCleanCityRefusesEmptyLongAndBrokenNames(t *testing.T) {
	for name, raw := range map[string]string{
		"empty":    "   ",
		"too long": strings.Repeat("я", MaxCityRunes+1),
		"markup":   "Иркутск<script>",
		"control":  "Ирку\x00тск",
		"braces":   "{Иркутск}",
		"bar":      "Иркутск|Asia/Tokyo",
	} {
		if city, ok := CleanCity(raw); ok {
			t.Errorf("%s: accepted as %q", name, city)
		}
	}
}

func TestParseLocationTakesTheZoneAndTheName(t *testing.T) {
	for raw, want := range map[string]Location{
		"Asia/Irkutsk|Иркутск":         {City: "Иркутск", Zone: "Asia/Irkutsk"},
		"  Europe/Moscow | Подольск\n": {City: "Подольск", Zone: "Europe/Moscow"},
		"`Asia/Yekaterinburg|Тюмень`":  {City: "Тюмень", Zone: "Asia/Yekaterinburg"},
		"\"Asia/Vladivostok|Находка\"": {City: "Находка", Zone: "Asia/Vladivostok"},
		"Europe/Kaliningrad":           {Zone: "Europe/Kaliningrad"},
		"Asia/Irkutsk|Усть Илимск.":    {City: "Усть Илимск", Zone: "Asia/Irkutsk"},
	} {
		got, err := ParseLocation(raw)
		if err != nil || got != want {
			t.Errorf("%q: got %+v, %v, want %+v", raw, got, err, want)
		}
	}
}

func TestParseLocationRefusesAnythingElse(t *testing.T) {
	for _, raw := range []string{"", "UNKNOWN", "unknown.", "Moscow|Москва", "Asia/Nowhere|Нигде", "UTC+8", "Local|Дом", "Не знаю"} {
		if got, err := ParseLocation(raw); !errors.Is(err, ErrUnknown) {
			t.Errorf("%q: got %+v, %v", raw, got, err)
		}
	}
}

func TestDescribeGivesEverythingKnownAndCutsTheLongTexts(t *testing.T) {
	text := Describe(Query{City: "Иркутск", Note: "Живу в Ангарске, работаю дома", Social: "Геометки: Ангарск (12), Иркутск (2)"})

	for _, want := range []string{"Иркутск", "Ангарске", "Геометки: Ангарск (12)"} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q: %s", want, text)
		}
	}
	long := Describe(Query{Note: strings.Repeat("я", MaxNoteRunes+500), Social: strings.Repeat("ы", MaxSocialRunes+500)})
	if len([]rune(long)) > MaxNoteRunes+MaxSocialRunes+400 {
		t.Errorf("the texts were not cut: %d runes", len([]rune(long)))
	}
	if Describe(Query{Note: "  ", Social: ""}) != "" {
		t.Error("nothing to describe must give an empty text")
	}
}

func TestValidZone(t *testing.T) {
	if !ValidZone("Asia/Irkutsk") || ValidZone("") || ValidZone("Local") || ValidZone("Mars/Base") {
		t.Error("ValidZone gave a wrong answer")
	}
}
