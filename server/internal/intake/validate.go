package intake

import (
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"
)

func GoalLabel(id string) string {
	return goalLabels[id]
}

func PlatformLabel(platform string) string {
	if label, ok := platformLabels[platform]; ok {
		return label
	}
	return platformLabels[PlatformOther]
}

func Clean(links, references, goals []string, note string) (Draft, error) {
	networks, err := cleanLinks(links)
	if err != nil {
		return Draft{}, err
	}
	inspirations, err := cleanReferences(references, networks)
	if err != nil {
		return Draft{}, err
	}
	chosen, err := cleanGoals(goals)
	if err != nil {
		return Draft{}, err
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > MaxNoteRunes {
		return Draft{}, ErrLongText
	}
	return Draft{Networks: networks, References: inspirations, Goals: chosen, Note: note}, nil
}

func CleanStats(followers, reach *int, bestPost string) (*Stats, error) {
	bestPost = strings.TrimSpace(bestPost)
	if followers == nil && reach == nil && bestPost == "" {
		return nil, nil
	}
	for _, value := range []*int{followers, reach} {
		if value != nil && (*value < 0 || *value > MaxStatValue) {
			return nil, ErrBadStats
		}
	}
	if utf8.RuneCountInString(bestPost) > MaxBestPostRunes {
		return nil, ErrBadStats
	}
	return &Stats{Followers: followers, Reach: reach, BestPost: bestPost}, nil
}

func CleanSchedule(days []int, shootTime, publishTime string) (*Schedule, error) {
	shootTime = strings.TrimSpace(shootTime)
	publishTime = strings.TrimSpace(publishTime)
	chosen := make([]int, 0, len(days))
	for _, day := range days {
		if day < 0 || day >= len(WeekdayNames) {
			return nil, ErrBadSchedule
		}
		if !slices.Contains(chosen, day) {
			chosen = append(chosen, day)
		}
	}
	slices.Sort(chosen)
	for _, clock := range []string{shootTime, publishTime} {
		if clock != "" && !timePattern.MatchString(clock) {
			return nil, ErrBadSchedule
		}
	}
	if len(chosen) == 0 && shootTime == "" && publishTime == "" {
		return nil, nil
	}
	return &Schedule{ShootDays: chosen, ShootTime: shootTime, PublishTime: publishTime}, nil
}

func nonNil(networks []Network) []Network {
	if networks == nil {
		return []Network{}
	}
	return networks
}

func cleanReferences(links []string, own []Network) ([]Network, error) {
	if len(links) > MaxReferences {
		return nil, ErrTooManyRef
	}
	seen := make(map[string]struct{}, len(links)+len(own))
	for _, network := range own {
		seen[strings.ToLower(network.URL)] = struct{}{}
	}
	references := make([]Network, 0, len(links))
	for _, raw := range links {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		link, platform, ok := NormalizeLink(raw)
		if !ok {
			return nil, ErrBadLink
		}
		key := strings.ToLower(link)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		references = append(references, Network{Platform: platform, URL: link})
	}
	return references, nil
}

func cleanLinks(links []string) ([]Network, error) {
	if len(links) > MaxNetworks {
		return nil, ErrTooMany
	}
	seen := make(map[string]struct{}, len(links))
	networks := make([]Network, 0, len(links))
	for _, raw := range links {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		link, platform, ok := NormalizeLink(raw)
		if !ok {
			return nil, ErrBadLink
		}
		key := strings.ToLower(link)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		networks = append(networks, Network{Platform: platform, URL: link})
	}
	if len(networks) == 0 {
		return nil, ErrNoNetworks
	}
	return networks, nil
}

func cleanGoals(goals []string) ([]string, error) {
	if len(goals) > MaxGoals {
		return nil, ErrBadGoal
	}
	seen := make(map[string]struct{}, len(goals))
	chosen := make([]string, 0, len(goals))
	for _, id := range goals {
		id = strings.TrimSpace(id)
		if _, known := goalLabels[id]; !known {
			return nil, ErrBadGoal
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		chosen = append(chosen, id)
	}
	if len(chosen) == 0 {
		return nil, ErrNoGoals
	}
	return chosen, nil
}

func NormalizeLink(raw string) (link, platform string, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return "", "", false
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + strings.TrimPrefix(raw, "//")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", "", false
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if !strings.Contains(host, ".") {
		return "", "", false
	}
	parsed.Scheme = "https"
	parsed.Host = host
	parsed.Fragment = ""
	platform = detectPlatform(host)
	path := strings.Trim(parsed.Path, "/")
	if platform != PlatformOther && utf8.RuneCountInString(path) < MinPathRunes {
		return "", "", false
	}
	link = parsed.String()
	if utf8.RuneCountInString(link) > MaxURLRunes {
		return "", "", false
	}
	return link, platform, true
}

func detectPlatform(host string) string {
	for known, platform := range platformHosts {
		if host == known || strings.HasSuffix(host, "."+known) {
			return platform
		}
	}
	return PlatformOther
}
