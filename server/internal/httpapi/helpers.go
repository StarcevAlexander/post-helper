package httpapi

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func limitParam(raw string) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return value
}

func clipRunes(text string, maxRunes int) string {
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	return string([]rune(text)[:maxRunes])
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get(HeaderForwardedFor); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if address := strings.TrimSpace(first); address != "" {
			return address
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
