package audit

import (
	"strings"
	"testing"
)

func intPtr(value int) *int { return &value }

func TestDescribeCollectedWritesProfileNumbersAndPosts(t *testing.T) {
	text := DescribeCollected(Collected{
		Handle:      "anna_nails",
		Name:        "Анна | Маникюр",
		Bio:         "Маникюр в Иркутске",
		ExternalURL: "https://t.me/anna",
		Followers:   intPtr(1250),
		PostsCount:  intPtr(84),
		Highlights:  []string{"Работы", "Цены", " "},
		Posts: []CollectedPost{
			{Type: "reel", Caption: "Нюд на неделю", Likes: intPtr(120), Comments: intPtr(7), Views: intPtr(3400), Date: "2026-10-12"},
			{Type: "post", Caption: "Окошки на пятницу", Likes: intPtr(40)},
		},
		Notes: "Профиль открыт без входа",
	})

	for _, want := range []string{
		"@anna_nails", "Имя в профиле: Анна | Маникюр", "Описание: Маникюр в Иркутске", "Подписчиков: 1250", "Публикаций: 84",
		"Актуальное: Работы, Цены", "Публикация 1 (reel, 2026-10-12)", "Подпись: Нюд на неделю", "Лайков: 120", "Просмотров: 3400",
		"Публикация 2 (post)", "Заметки сборщика: Профиль открыт без входа",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("text lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "Подписок:") {
		t.Errorf("an unknown number must not be written:\n%s", text)
	}
}

func TestDescribeCollectedCapsEverythingAndSkipsBadNumbers(t *testing.T) {
	posts := make([]CollectedPost, 0, 40)
	for i := 0; i < 40; i++ {
		posts = append(posts, CollectedPost{Type: "post", Caption: strings.Repeat("я", MaxCollectedCaption+50), Likes: intPtr(-5)})
	}

	text := DescribeCollected(Collected{Handle: "a", Bio: strings.Repeat("б", MaxCollectedBioRunes+50), Followers: intPtr(-1), Posts: posts})

	if strings.Count(text, "Публикация ") != MaxCollectedPosts {
		t.Errorf("posts = %d", strings.Count(text, "Публикация "))
	}
	if strings.Contains(text, "Лайков") || strings.Contains(text, "Подписчиков") {
		t.Errorf("negative numbers must be dropped:\n%s", text[:300])
	}
	if strings.Contains(text, strings.Repeat("я", MaxCollectedCaption+1)) {
		t.Error("a caption must be cut")
	}
}

func TestDescribeRequestAppendsTheCollectedData(t *testing.T) {
	text := describeRequest(Request{Extra: "Данные профиля, собранные из браузера:\nНик: @anna"})

	if !strings.Contains(text, "@anna") {
		t.Errorf("text = %s", text)
	}
}
