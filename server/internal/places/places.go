package places

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	MaxCityRunes    = 100
	MaxNoteRunes    = 2000
	MaxSocialRunes  = 1500
	MaxOutputTokens = 80
	RequestTimeout  = 30 * time.Second
	Separator       = "|"
)

var ErrUnknown = errors.New("place is unknown")

const SystemPrompt = `Ты определяешь населённый пункт и его часовой пояс. Тебе дают название населённого пункта мастера (обычно в России), текст его пожеланий и/или данные его страниц в соцсетях (адрес или город в шапке, самые частые геометки публикаций). Если населённый пункт дан явно, используй его. Если не дан, найди в пожеланиях, где мастер живёт или работает; если там нет, определи по соцсетям: адрес в шапке важнее, затем геометка, которая встречается чаще всего. Ответь строго одной строкой в виде: идентификатор часового пояса из базы IANA, вертикальная черта, название населённого пункта. Примеры: Asia/Irkutsk|Иркутск, Europe/Moscow|Подольск, Asia/Yekaterinburg|Тюмень. Если населённый пункт неоднозначен, выбери самый крупный. Если места нет и определить нельзя, ответь UNKNOWN. Никаких пояснений и кавычек.`

type Location struct {
	City string
	Zone string
}

type Query struct {
	City   string
	Note   string
	Social string
}

type Resolver interface {
	Locate(ctx context.Context, query Query) (Location, error)
}

func CleanCity(raw string) (string, bool) {
	city := strings.Join(strings.Fields(raw), " ")
	if city == "" || utf8.RuneCountInString(city) > MaxCityRunes {
		return "", false
	}
	for _, symbol := range city {
		if symbol < ' ' || symbol == '<' || symbol == '>' || symbol == '{' || symbol == '}' || symbol == '|' {
			return "", false
		}
	}
	return city, true
}

func ValidZone(name string) bool {
	if name == "" || name == "Local" {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

func ParseLocation(raw string) (Location, error) {
	line := strings.TrimSpace(strings.Trim(strings.TrimSpace(raw), "`'\""))
	if line == "" || strings.EqualFold(strings.Trim(line, ".\"'` "), "UNKNOWN") {
		return Location{}, ErrUnknown
	}
	zonePart, namePart, _ := strings.Cut(line, Separator)
	var zone string
	for candidate := range strings.FieldsSeq(zonePart) {
		candidate = strings.Trim(candidate, "`'\".,;:()[]")
		if strings.Contains(candidate, "/") && ValidZone(candidate) {
			zone = candidate
			break
		}
	}
	if zone == "" {
		return Location{}, ErrUnknown
	}
	city, _ := CleanCity(strings.Trim(strings.TrimSpace(namePart), "`'\".,;:"))
	return Location{City: city, Zone: zone}, nil
}
