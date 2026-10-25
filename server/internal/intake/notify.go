package intake

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type Telegram struct {
	token   string
	chatID  string
	baseURL string
	client  *http.Client
}

func NewTelegram(token, chatID string) *Telegram {
	if token == "" || chatID == "" {
		return nil
	}
	return &Telegram{token: token, chatID: chatID, baseURL: TelegramBaseURL, client: &http.Client{Timeout: TelegramTimeout}}
}

func (t *Telegram) WithBaseURL(baseURL string) *Telegram {
	t.baseURL = strings.TrimRight(baseURL, "/")
	return t
}

func (t *Telegram) Notify(ctx context.Context, text string) error {
	form := url.Values{"chat_id": {t.chatID}, "text": {clip(text)}, "disable_web_page_preview": {"true"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/bot%s/sendMessage", t.baseURL, t.token), strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := t.client.Do(request)
	if err != nil {
		return fmt.Errorf("telegram request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 300))
		return fmt.Errorf("telegram answered %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func Announcement(request Request, masterName string, updated, review bool) string {
	var text strings.Builder
	if review {
		text.WriteString("Мастер просит итоги месяца (/content-review)\n")
	} else if updated {
		text.WriteString("Заявка обновлена\n")
	} else {
		text.WriteString("Новая заявка на контент-план\n")
	}
	fmt.Fprintf(&text, "Мастер: %s\n", masterName)
	if request.City != "" {
		fmt.Fprintf(&text, "Населённый пункт: %s\n", request.City)
	}
	text.WriteString("\nСоцсети:\n")
	for _, network := range request.Networks {
		fmt.Fprintf(&text, "• %s: %s\n", PlatformLabel(network.Platform), network.URL)
	}
	if len(request.References) > 0 {
		text.WriteString("\nРеференсы (чей контент и стиль взять за образец или переработать):\n")
		for _, reference := range request.References {
			fmt.Fprintf(&text, "• %s: %s\n", PlatformLabel(reference.Platform), reference.URL)
		}
	}
	text.WriteString("\nЦели:\n")
	for _, goal := range request.Goals {
		fmt.Fprintf(&text, "• %s\n", GoalLabel(goal))
	}
	if request.Note != "" {
		fmt.Fprintf(&text, "\nПожелания и рекомендации:\n%s\n", request.Note)
	}
	if schedule := ScheduleLines(request.Schedule); len(schedule) > 0 {
		text.WriteString("\nКогда мастеру удобно (расписание плана строить по этому):\n")
		for _, line := range schedule {
			fmt.Fprintf(&text, "• %s\n", line)
		}
	}
	if stats := StatsLines(request.Stats); len(stats) > 0 {
		text.WriteString("\nЦифры за месяц от мастера:\n")
		for _, line := range stats {
			fmt.Fprintf(&text, "• %s\n", line)
		}
	}
	if mentionsInstagram(request) {
		text.WriteString("\n* " + MetaNote + "\n")
	}
	fmt.Fprintf(&text, "\nid мастера: %s", request.MasterID)
	return text.String()
}

func ScheduleLines(schedule *Schedule) []string {
	if schedule == nil {
		return nil
	}
	var lines []string
	if len(schedule.ShootDays) > 0 {
		names := make([]string, 0, len(schedule.ShootDays))
		for _, day := range schedule.ShootDays {
			if day >= 0 && day < len(WeekdayNames) {
				names = append(names, WeekdayNames[day])
			}
		}
		lines = append(lines, "Дни съёмки: "+strings.Join(names, ", "))
	}
	if schedule.ShootTime != "" {
		lines = append(lines, "Время съёмки: "+schedule.ShootTime)
	}
	if schedule.PublishTime != "" {
		lines = append(lines, "Время публикаций: "+schedule.PublishTime)
	}
	return lines
}

func StatsLines(stats *Stats) []string {
	if stats == nil {
		return nil
	}
	var lines []string
	if stats.Followers != nil {
		lines = append(lines, fmt.Sprintf("Подписчиков сейчас: %d", *stats.Followers))
	}
	if stats.Reach != nil {
		lines = append(lines, fmt.Sprintf("Охват за месяц: %d", *stats.Reach))
	}
	if stats.BestPost != "" {
		lines = append(lines, "Лучшая публикация: "+stats.BestPost)
	}
	return lines
}

func clip(text string) string {
	runes := []rune(text)
	if len(runes) <= TelegramMaxRunes {
		return text
	}
	return string(runes[:TelegramMaxRunes-1]) + "…"
}

func mentionsInstagram(request Request) bool {
	for _, network := range append(append([]Network{}, request.Networks...), request.References...) {
		if network.Platform == PlatformInstagram {
			return true
		}
	}
	return false
}
