package kit

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
	return &Claude{
		client: anthropic.NewClient(allOptions...),
		model:  model,
	}
}

func (c *Claude) Generate(ctx context.Context, request Request) (Kit, error) {
	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(describeRequest(request)))},
	})
	if err != nil {
		return Kit{}, fmt.Errorf("claude kit request: %w", err)
	}

	if response.StopReason == anthropic.StopReasonRefusal {
		return Kit{}, ErrRefused
	}

	var text strings.Builder
	for _, block := range response.Content {
		if part, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(part.Text)
		}
	}
	return parseKit(text.String(), request.Format)
}

func describeRequest(request Request) string {
	var text strings.Builder
	text.WriteString(strategy.DescribeProfile(request.Profile))
	if positioning := strings.TrimSpace(request.Positioning); positioning != "" {
		fmt.Fprintf(&text, "\nПозиционирование: %s\n", positioning)
	}
	fmt.Fprintf(&text, "\nПубликация:\nФормат: %s\nРубрика: %s\nИдея: %s\n", formatName(request.Format), request.Pillar, request.Idea)
	return text.String()
}

func formatName(format string) string {
	switch format {
	case FormatReels:
		return "Reels (вертикальное видео)"
	case FormatPost:
		return "пост (фото или карусель)"
	default:
		return "серия сторис"
	}
}

func parseKit(raw, format string) (Kit, error) {
	kit, found := lastKitObject(raw)
	if !found {
		return Kit{}, ErrBadKit
	}
	return normalize(kit, format)
}

func normalize(kit Kit, format string) (Kit, error) {
	limits, ok := FrameLimits[format]
	if !ok {
		return Kit{}, ErrBadKit
	}

	frames := make([]Frame, 0, limits.Max)
	for _, frame := range kit.Frames {
		frame.Visual = truncateRunes(strings.TrimSpace(frame.Visual), MaxVisualRunes)
		frame.Overlay = truncateRunes(strings.TrimSpace(frame.Overlay), MaxOverlayRunes)
		if frame.Visual == "" && frame.Overlay == "" {
			continue
		}
		frames = append(frames, frame)
		if len(frames) == limits.Max {
			break
		}
	}
	kit.Frames = frames
	kit.Shots = cleanList(kit.Shots, MaxShots, MaxShotRunes)
	kit.Hashtags = cleanHashtags(kit.Hashtags)
	kit.Caption = truncateRunes(strings.TrimSpace(kit.Caption), MaxCaptionRunes)
	kit.Tip = truncateRunes(strings.TrimSpace(kit.Tip), MaxTipRunes)

	if len(kit.Frames) == 0 || (format != FormatStories && kit.Caption == "") {
		return Kit{}, ErrBadKit
	}
	return kit, nil
}

func lastKitObject(raw string) (Kit, bool) {
	var kit Kit
	found := false
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var candidate Kit
		if err := decoder.Decode(&candidate); err == nil && len(candidate.Frames) > 0 {
			kit, found = candidate, true
			offset = start + int(decoder.InputOffset())
			continue
		}
		offset = start + 1
	}
	return kit, found
}

func cleanHashtags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	cleaned := make([]string, 0, MaxHashtags)
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag != "" && !strings.HasPrefix(tag, "#") {
			tag = "#" + tag
		}
		if utf8.RuneCountInString(tag) < 2 || utf8.RuneCountInString(tag) > MaxHashtagRunes || strings.ContainsAny(tag, " \t\n") {
			continue
		}
		key := strings.ToLower(tag)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		cleaned = append(cleaned, tag)
		if len(cleaned) == MaxHashtags {
			break
		}
	}
	return cleaned
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

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit-1]) + "…"
}
