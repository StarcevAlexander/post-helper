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

func CleanItemID(raw string) (string, error) {
	itemID := strings.TrimSpace(raw)
	if itemID == "" {
		return "", nil
	}
	if utf8.RuneCountInString(itemID) > MaxItemIDRunes || strings.ContainsAny(itemID, " \t\r\n") {
		return "", ErrBadItem
	}
	return itemID, nil
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
	if message.ItemID != "" {
		text.WriteString("Мастер просит заменить идею публикации\n")
	} else {
		text.WriteString("Обратная связь из приложения\n")
	}
	fmt.Fprintf(&text, "Мастер: %s\n", message.MasterName)
	if message.Email != "" {
		fmt.Fprintf(&text, "Почта аккаунта: %s\n", message.Email)
	}
	if message.Contact != "" {
		fmt.Fprintf(&text, "Контакт для связи: %s\n", message.Contact)
	}
	if message.ItemID != "" {
		fmt.Fprintf(&text, "Публикация: %s (id %s)\n\nЧто хочет вместо неё:\n%s\n", message.ItemLabel, message.ItemID, message.Text)
		fmt.Fprintf(&text, "\nЗамена: owner.mjs plan %s plan.json с новой idea в calendar и комплектом kits[%q]\n", message.MasterID, message.ItemID)
	} else {
		fmt.Fprintf(&text, "\n%s\n", message.Text)
	}
	fmt.Fprintf(&text, "\nid мастера: %s", message.MasterID)
	return text.String()
}
