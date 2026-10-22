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

func Announcement(request Request, masterName string, updated bool) string {
	var text strings.Builder
	if updated {
		text.WriteString("Заявка обновлена\n")
	} else {
		text.WriteString("Новая заявка на контент-план\n")
	}
	fmt.Fprintf(&text, "Мастер: %s\n\nСоцсети:\n", masterName)
	for _, network := range request.Networks {
		fmt.Fprintf(&text, "• %s: %s\n", PlatformLabel(network.Platform), network.URL)
	}
	text.WriteString("\nЦели:\n")
	for _, goal := range request.Goals {
		fmt.Fprintf(&text, "• %s\n", GoalLabel(goal))
	}
	if request.Note != "" {
		fmt.Fprintf(&text, "\nПожелания и рекомендации:\n%s\n", request.Note)
	}
	fmt.Fprintf(&text, "\nid мастера: %s", request.MasterID)
	return text.String()
}

func clip(text string) string {
	runes := []rune(text)
	if len(runes) <= TelegramMaxRunes {
		return text
	}
	return string(runes[:TelegramMaxRunes-1]) + "…"
}
