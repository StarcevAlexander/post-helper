package refs

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
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
	return &Claude{client: anthropic.NewClient(allOptions...), model: model}
}

func (c *Claude) Generate(ctx context.Context, request Request) (Plan, error) {
	want := WantedCount(request)
	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: systemPromptFor(want)}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(describeRequest(request)))},
	})
	if err != nil {
		return Plan{}, fmt.Errorf("claude refs request: %w", err)
	}
	if response.StopReason == anthropic.StopReasonRefusal {
		return Plan{}, ErrRefused
	}
	var text strings.Builder
	for _, block := range response.Content {
		if part, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(part.Text)
		}
	}
	return ParsePlanFor(text.String(), want)
}

func WantedCount(request Request) int {
	if len(request.Frames) == 0 {
		return PerItem
	}
	return min(len(request.Frames), MaxPerItem)
}

func systemPromptFor(count int) string {
	return strings.ReplaceAll(SystemPrompt, "{N}", strconv.Itoa(count))
}

func describeRequest(request Request) string {
	var text strings.Builder
	text.WriteString(request.About)
	fmt.Fprintf(&text, "\nПункт плана:\nФормат публикации: %s\nРубрика: %s\nИдея: %s\nРеференсы нужны как: фото\n",
		request.Item.Format, request.Item.Pillar, request.Item.Idea)
	if len(request.Frames) > 0 {
		text.WriteString("\nСписок кадров публикации по порядку:\n")
		for index, frame := range request.Frames {
			fmt.Fprintf(&text, "%d. %s\n", index+1, truncate(frame, MaxFieldRunes))
		}
	}
	return text.String()
}

func ParsePlan(raw string) (Plan, error) {
	return ParsePlanFor(raw, PerItem)
}

func ParsePlanFor(raw string, want int) (Plan, error) {
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var candidate Plan
		if err := decoder.Decode(&candidate); err == nil && len(candidate.Prompts) > 0 {
			return normalize(candidate, want)
		}
		offset = start + 1
	}
	return Plan{}, ErrBadPlan
}

func normalize(plan Plan, want int) (Plan, error) {
	cleaned := make([]Prompt, 0, want)
	for _, prompt := range plan.Prompts {
		prompt.Prompt = truncate(strings.TrimSpace(prompt.Prompt), MaxPromptRunes)
		prompt.Caption = truncate(strings.TrimSpace(prompt.Caption), MaxCaptionRunes)
		if prompt.Prompt == "" {
			continue
		}
		cleaned = append(cleaned, prompt)
		if len(cleaned) == want {
			break
		}
	}
	if len(cleaned) < want {
		return Plan{}, ErrBadPlan
	}
	return Plan{Prompts: cleaned}, nil
}

func truncate(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit-1]) + "…"
}
