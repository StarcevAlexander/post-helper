package push

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

func CleanSubscription(endpoint, p256dh, auth string) (Subscription, error) {
	subscription := Subscription{
		Endpoint: strings.TrimSpace(endpoint),
		P256dh:   strings.TrimSpace(p256dh),
		Auth:     strings.TrimSpace(auth),
	}
	if subscription.Endpoint == "" || len(subscription.Endpoint) > MaxEndpointLength {
		return Subscription{}, ErrInvalidSubscription
	}
	parsed, err := url.Parse(subscription.Endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return Subscription{}, ErrInvalidSubscription
	}
	for _, key := range []string{subscription.P256dh, subscription.Auth} {
		if key == "" || len(key) > MaxKeyLength {
			return Subscription{}, ErrInvalidSubscription
		}
	}
	return subscription, nil
}

func CleanMessage(title, body, target string) (Message, error) {
	message := Message{
		Title: strings.TrimSpace(title),
		Body:  strings.TrimSpace(body),
		URL:   strings.TrimSpace(target),
	}
	if message.Title == "" || utf8.RuneCountInString(message.Title) > MaxTitleRunes {
		return Message{}, ErrInvalidMessage
	}
	if utf8.RuneCountInString(message.Body) > MaxBodyRunes {
		return Message{}, ErrInvalidMessage
	}
	if message.URL == "" {
		message.URL = DefaultURL
	}
	if len(message.URL) > MaxURLLength || !strings.HasPrefix(message.URL, "./") {
		return Message{}, ErrInvalidMessage
	}
	return message, nil
}
