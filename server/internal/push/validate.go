package push

import (
	"net"
	"net/netip"
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
	if err != nil || parsed.Scheme != EndpointScheme || parsed.Host == "" || !allowedEndpointHost(parsed) {
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
		Topic: Topic{Kind: KindMessage},
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

func allowedEndpointHost(endpoint *url.URL) bool {
	if port := endpoint.Port(); port != "" && port != AllowedEndpointPort {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(endpoint.Hostname()), ".")
	if host == "" {
		return false
	}
	if address, err := netip.ParseAddr(host); err == nil {
		return !blockedAddress(address)
	}
	if net.ParseIP(host) != nil {
		return false
	}
	if host == LocalHostName {
		return false
	}
	for _, suffix := range blockedHostSuffixes {
		if strings.HasSuffix(host, suffix) {
			return false
		}
	}
	return true
}

func blockedAddress(address netip.Addr) bool {
	address = address.Unmap()
	return address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast()
}
