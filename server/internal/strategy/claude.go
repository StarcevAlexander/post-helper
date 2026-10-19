package strategy

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

type Claude struct {
	client anthropic.Client
	model  string
}

func NewClaude(apiKey, model string, options ...option.RequestOption) *Claude {
	allOptions := append([]option.RequestOption{option.WithAPIKey(apiKey)}, options...)
	return &Claude{
		client: anthropic.NewClient(allOptions...),
		model:  model,
	}
}

func (c *Claude) Generate(ctx context.Context, profile Profile) (Strategy, error) {
	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(DescribeProfile(profile)))},
	})
	if err != nil {
		return Strategy{}, fmt.Errorf("claude strategy request: %w", err)
	}

	if response.StopReason == anthropic.StopReasonRefusal {
		return Strategy{}, ErrRefused
	}

	var text strings.Builder
	for _, block := range response.Content {
		if part, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(part.Text)
		}
	}
	return parseStrategy(text.String())
}

func DescribeProfile(profile Profile) string {
	fields := []struct{ label, value string }{
		{"Имя", profile.Name},
		{"Чем занимается", profile.Specialty},
		{"Город", profile.City},
		{"Опыт", profile.Experience},
		{"Услуги и цены", profile.Services},
		{"Кто клиенты", profile.Clients},
		{"Цель", profile.Goal},
		{"Instagram", profile.Instagram},
		{"Как обычно пишет и говорит", profile.Style},
	}
	var text strings.Builder
	text.WriteString("Анкета мастера:\n")
	for _, field := range fields {
		if value := strings.TrimSpace(field.value); value != "" {
			fmt.Fprintf(&text, "%s: %s\n", field.label, value)
		}
	}
	return text.String()
}

func parseStrategy(raw string) (Strategy, error) {
	strategy, found := lastStrategyObject(raw)
	if !found {
		return Strategy{}, ErrBadStrategy
	}
	if reason := strings.TrimSpace(strategy.Insufficient); reason != "" {
		return Strategy{}, &InsufficientError{Reason: truncateRunes(reason, MaxReasonRunes)}
	}
	return normalize(strategy)
}

func normalize(strategy Strategy) (Strategy, error) {
	strategy.Summary = truncateRunes(strings.TrimSpace(strategy.Summary), MaxSummaryRunes)
	strategy.Positioning = truncateRunes(strings.TrimSpace(strategy.Positioning), MaxPositioningRunes)
	strategy.ProfileFixes = cleanList(strategy.ProfileFixes, MaxProfileFixes, MaxItemRunes)
	strategy.FirstSteps = cleanList(strategy.FirstSteps, MaxFirstSteps, MaxItemRunes)

	pillars := make([]Pillar, 0, MaxPillars)
	for _, pillar := range strategy.Pillars {
		pillar.Title = truncateRunes(strings.TrimSpace(pillar.Title), MaxItemRunes)
		pillar.Description = truncateRunes(strings.TrimSpace(pillar.Description), MaxItemRunes)
		pillar.Ideas = cleanList(pillar.Ideas, MaxIdeas, MaxItemRunes)
		if pillar.Title == "" {
			continue
		}
		pillars = append(pillars, pillar)
		if len(pillars) == MaxPillars {
			break
		}
	}
	strategy.Pillars = pillars

	strategy.Cadence.Reels = clamp(strategy.Cadence.Reels, 0, MaxPerWeek)
	strategy.Cadence.Posts = clamp(strategy.Cadence.Posts, 0, MaxPerWeek)
	strategy.Cadence.Stories = clamp(strategy.Cadence.Stories, 0, MaxPerWeek)
	strategy.Cadence.Note = truncateRunes(strings.TrimSpace(strategy.Cadence.Note), MaxNoteRunes)

	if strategy.Summary == "" || len(strategy.Pillars) < MinPillars {
		return Strategy{}, ErrBadStrategy
	}
	return strategy, nil
}

func lastStrategyObject(raw string) (Strategy, bool) {
	var strategy Strategy
	found := false
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var candidate Strategy
		if err := decoder.Decode(&candidate); err == nil && (strings.TrimSpace(candidate.Summary) != "" || strings.TrimSpace(candidate.Insufficient) != "") {
			strategy, found = candidate, true
			offset = start + int(decoder.InputOffset())
			continue
		}
		offset = start + 1
	}
	return strategy, found
}

func cleanList(items []string, limit, runes int) []string {
	cleaned := make([]string, 0, limit)
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		cleaned = append(cleaned, truncateRunes(item, runes))
		if len(cleaned) == limit {
			break
		}
	}
	return cleaned
}

func clamp(value, low, high int) int {
	return min(max(value, low), high)
}

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit-1]) + "…"
}
