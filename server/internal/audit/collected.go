package audit

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	MaxAgentImages       = 12
	MaxCollectedPosts    = 20
	MaxCollectedBioRunes = 600
	MaxCollectedCaption  = 1500
	MaxCollectedNote     = 1000
	MaxCollectedShort    = 200
	MaxGeoTags           = 20
)

type CollectedPost struct {
	Type     string `json:"type"`
	Caption  string `json:"caption"`
	Likes    *int   `json:"likes"`
	Comments *int   `json:"comments"`
	Views    *int   `json:"views"`
	Date     string `json:"date"`
	URL      string `json:"url"`
}

type GeoTag struct {
	Name  string `json:"name"`
	Count *int   `json:"count"`
}

type Collected struct {
	Handle      string          `json:"handle"`
	Name        string          `json:"name"`
	Bio         string          `json:"bio"`
	ExternalURL string          `json:"externalUrl"`
	Category    string          `json:"category"`
	Followers   *int            `json:"followers"`
	Following   *int            `json:"following"`
	PostsCount  *int            `json:"postsCount"`
	Location    string          `json:"location"`
	GeoTags     []GeoTag        `json:"geoTags"`
	Highlights  []string        `json:"highlights"`
	Posts       []CollectedPost `json:"posts"`
	Notes       string          `json:"notes"`
}

func clipText(text string, limit int) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit-1]) + "…"
}

func number(label string, value *int) string {
	if value == nil || *value < 0 {
		return ""
	}
	return fmt.Sprintf("%s: %d\n", label, *value)
}

func DescribeCollected(data Collected) string {
	var text strings.Builder
	text.WriteString("Данные профиля, собранные из браузера:\n")
	fmt.Fprintf(&text, "Ник: @%s\n", clipText(data.Handle, MaxCollectedShort))
	for _, field := range []struct{ label, value string }{
		{"Имя в профиле", clipText(data.Name, MaxCollectedShort)},
		{"Категория", clipText(data.Category, MaxCollectedShort)},
		{"Описание", clipText(data.Bio, MaxCollectedBioRunes)},
		{"Ссылка в шапке", clipText(data.ExternalURL, MaxCollectedShort)},
		{"Адрес или город в шапке", clipText(data.Location, MaxCollectedShort)},
	} {
		if field.value != "" {
			fmt.Fprintf(&text, "%s: %s\n", field.label, field.value)
		}
	}
	text.WriteString(number("Подписчиков", data.Followers))
	text.WriteString(number("Подписок", data.Following))
	text.WriteString(number("Публикаций", data.PostsCount))
	if tags := geoTagLine(data.GeoTags); tags != "" {
		fmt.Fprintf(&text, "Геометки публикаций (по частоте): %s\n", tags)
	}
	if len(data.Highlights) > 0 {
		names := make([]string, 0, len(data.Highlights))
		for _, name := range data.Highlights {
			if name = clipText(name, 60); name != "" {
				names = append(names, name)
			}
		}
		if len(names) > 0 {
			fmt.Fprintf(&text, "Актуальное: %s\n", strings.Join(names, ", "))
		}
	}
	posts := data.Posts
	if len(posts) > MaxCollectedPosts {
		posts = posts[:MaxCollectedPosts]
	}
	for index, post := range posts {
		fmt.Fprintf(&text, "\nПубликация %d (%s", index+1, clipText(post.Type, 30))
		if date := clipText(post.Date, 40); date != "" {
			fmt.Fprintf(&text, ", %s", date)
		}
		text.WriteString(")\n")
		if caption := clipText(post.Caption, MaxCollectedCaption); caption != "" {
			fmt.Fprintf(&text, "Подпись: %s\n", caption)
		}
		text.WriteString(number("Лайков", post.Likes))
		text.WriteString(number("Комментариев", post.Comments))
		text.WriteString(number("Просмотров", post.Views))
	}
	if notes := clipText(data.Notes, MaxCollectedNote); notes != "" {
		fmt.Fprintf(&text, "\nЗаметки сборщика: %s\n", notes)
	}
	return text.String()
}

func geoTagLine(tags []GeoTag) string {
	if len(tags) > MaxGeoTags {
		tags = tags[:MaxGeoTags]
	}
	parts := make([]string, 0, len(tags))
	for _, tag := range tags {
		name := clipText(tag.Name, MaxCollectedShort)
		if name == "" {
			continue
		}
		if tag.Count != nil && *tag.Count > 0 {
			name = fmt.Sprintf("%s (%d)", name, *tag.Count)
		}
		parts = append(parts, name)
	}
	return strings.Join(parts, ", ")
}

func (data Collected) PlaceHint() string {
	var hint strings.Builder
	if location := clipText(data.Location, MaxCollectedShort); location != "" {
		fmt.Fprintf(&hint, "Адрес или город в шапке: %s. ", location)
	}
	if tags := geoTagLine(data.GeoTags); tags != "" {
		fmt.Fprintf(&hint, "Геометки публикаций по частоте: %s.", tags)
	}
	return strings.TrimSpace(hint.String())
}
