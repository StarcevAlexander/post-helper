package feedback

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode/utf8"
)

func Clean(text, contact string) (string, string, error) {
	text = strings.TrimSpace(text)
	contact = strings.TrimSpace(contact)
	if text == "" {
		return "", "", ErrEmptyText
	}
	if utf8.RuneCountInString(text) > MaxTextRunes {
		return "", "", ErrLongText
	}
	if utf8.RuneCountInString(contact) > MaxContactRunes {
		return "", "", ErrLongContact
	}
	return text, contact, nil
}

func NewID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func Announcement(message Message) string {
	var text strings.Builder
	text.WriteString("Обратная связь из приложения\n")
	fmt.Fprintf(&text, "Мастер: %s\n", message.MasterName)
	if message.Email != "" {
		fmt.Fprintf(&text, "Почта аккаунта: %s\n", message.Email)
	}
	if message.Contact != "" {
		fmt.Fprintf(&text, "Контакт для связи: %s\n", message.Contact)
	}
	fmt.Fprintf(&text, "\n%s\n\nid мастера: %s", message.Text, message.MasterID)
	return text.String()
}
