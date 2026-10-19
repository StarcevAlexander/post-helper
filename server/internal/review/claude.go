package review

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"post-helper/server/internal/strategy"
)

type Claude struct {
	client anthropic.Client
	model  string
}

func NewClaude(apiKey, model string, options ...option.RequestOption) *Claude {
	allOptions := append([]option.RequestOption{option.WithAPIKey(apiKey)}, options...)
	return &Claude{client: anthropic.NewClient(allOptions...), model: model}
}

func (c *Claude) Generate(ctx context.Context, request Request) (Review, error) {
	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(describeRequest(request)))},
	})
	if err != nil {
		return Review{}, fmt.Errorf("claude review request: %w", err)
	}
	if response.StopReason == anthropic.StopReasonRefusal {
		return Review{}, ErrRefused
	}

	var text strings.Builder
	for _, block := range response.Content {
		if part, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(part.Text)
		}
	}
	return parseReview(text.String(), request.Cadence)
}

func describeRequest(request Request) string {
	var text strings.Builder
	text.WriteString(strategy.DescribeProfile(request.Profile))
	if positioning := strings.TrimSpace(request.Positioning); positioning != "" {
		fmt.Fprintf(&text, "\nПозиционирование: %s\n", positioning)
	}
	fmt.Fprintf(&text, "\nТекущий ритм в неделю: Reels %d, посты %d, сторис %d.\n",
		request.Cadence.Reels, request.Cadence.Posts, request.Cadence.Stories)

	text.WriteString("\nРубрики и существующие идеи:\n")
	for _, pillar := range request.Pillars {
		fmt.Fprintf(&text, "- %s: %s\n", pillar.Title, strings.Join(pillar.Ideas, "; "))
	}

	done := 0
	text.WriteString("\nПлан недели:\n")
	for _, item := range request.Items {
		mark := "не сделано"
		if item.Done {
			mark = "сделано"
			done++
		}
		fmt.Fprintf(&text, "- [%s] %s, рубрика «%s»: %s\n", mark, item.Format, item.Pillar, item.Idea)
	}
	fmt.Fprintf(&text, "Выполнено %d из %d.\n", done, len(request.Items))

	text.WriteString("\nОтветы мастера:\n")
	if request.Results.Inquiries != nil {
		fmt.Fprintf(&text, "Обращений из Instagram за неделю: %d\n", *request.Results.Inquiries)
	} else {
		text.WriteString("Обращений из Instagram за неделю: мастер не знает\n")
	}
	if best := strings.TrimSpace(request.Results.BestIdea); best != "" {
		fmt.Fprintf(&text, "Лучше всего сработало: %s\n", best)
	}
	if hard := strings.TrimSpace(request.Results.Hard); hard != "" {
		fmt.Fprintf(&text, "Что было трудно: %s\n", hard)
	}
	return text.String()
}

func parseReview(raw string, previous strategy.Cadence) (Review, error) {
	review, found := lastReviewObject(raw)
	if !found {
		return Review{}, ErrBadReview
	}
	return normalize(review, previous)
}

func normalize(review Review, previous strategy.Cadence) (Review, error) {
	review.Headline = truncateRunes(strings.TrimSpace(review.Headline), MaxHeadlineRunes)
	review.NextFocus = truncateRunes(strings.TrimSpace(review.NextFocus), MaxItemRunes)
	review.WhatWorked = cleanList(review.WhatWorked, MaxListItems, MaxItemRunes)
	review.WhatToChange = cleanList(review.WhatToChange, MaxListItems, MaxItemRunes)

	groups := make([]NewIdeas, 0, MaxNewIdeaPillars)
	for _, group := range review.NewIdeas {
		group.Pillar = truncateRunes(strings.TrimSpace(group.Pillar), MaxItemRunes)
		group.Ideas = cleanList(group.Ideas, MaxNewIdeas, MaxItemRunes)
		if group.Pillar == "" || len(group.Ideas) == 0 {
			continue
		}
		groups = append(groups, group)
		if len(groups) == MaxNewIdeaPillars {
			break
		}
	}
	review.NewIdeas = groups

	review.Cadence = strategy.Cadence{
		Reels:   clamp(review.Cadence.Reels, 0, MaxPerWeek),
		Posts:   clamp(review.Cadence.Posts, 0, MaxPerWeek),
		Stories: clamp(review.Cadence.Stories, 0, MaxPerWeek),
	}
	if review.Cadence.Reels+review.Cadence.Posts+review.Cadence.Stories == 0 {
		review.Cadence = strategy.Cadence{Reels: previous.Reels, Posts: previous.Posts, Stories: previous.Stories}
	}

	if review.Headline == "" || len(review.WhatToChange) == 0 {
		return Review{}, ErrBadReview
	}
	return review, nil
}

func lastReviewObject(raw string) (Review, bool) {
	var review Review
	found := false
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var candidate Review
		if err := decoder.Decode(&candidate); err == nil && strings.TrimSpace(candidate.Headline) != "" {
			review, found = candidate, true
			offset = start + int(decoder.InputOffset())
			continue
		}
		offset = start + 1
	}
	return review, found
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
