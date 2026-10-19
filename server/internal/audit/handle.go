package audit

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	handlePattern = regexp.MustCompile(`^[a-z0-9._]{1,30}$`)
	reservedPaths = map[string]struct{}{
		"p": {}, "reel": {}, "reels": {}, "explore": {}, "accounts": {}, "stories": {},
		"direct": {}, "tv": {}, "about": {}, "legal": {}, "web": {}, "developer": {}, "directory": {},
	}
)

func NormalizeHandle(input string) (string, bool) {
	value := strings.TrimSpace(input)
	if value == "" {
		return "", false
	}
	value = strings.TrimPrefix(value, "@")

	if strings.Contains(value, "/") || strings.Contains(value, "?") {
		if !strings.Contains(value, "://") {
			value = "https://" + value
		}
		parsed, err := url.Parse(value)
		if err != nil {
			return "", false
		}
		host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
		if host != "instagram.com" && host != "instagr.am" {
			return "", false
		}
		segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(segments) != 1 || segments[0] == "" {
			return "", false
		}
		value = segments[0]
	}

	value = strings.ToLower(strings.TrimPrefix(value, "@"))
	if !handlePattern.MatchString(value) {
		return "", false
	}
	if _, reserved := reservedPaths[value]; reserved {
		return "", false
	}
	if strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") || strings.Contains(value, "..") {
		return "", false
	}
	return value, true
}
