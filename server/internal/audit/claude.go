package audit

import (
	"context"
	"encoding/base64"
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

func (c *Claude) Generate(ctx context.Context, request Request) (Result, error) {
	blocks := make([]anthropic.ContentBlockParamUnion, 0, len(request.Images)+1)
	for _, image := range request.Images {
		blocks = append(blocks, anthropic.NewImageBlockBase64(image.MediaType, base64.StdEncoding.EncodeToString(image.Data)))
	}
	blocks = append(blocks, anthropic.NewTextBlock(describeRequest(request)))

	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(blocks...)},
	})
	if err != nil {
		return Result{}, fmt.Errorf("claude audit request: %w", err)
	}
	if response.StopReason == anthropic.StopReasonRefusal {
		return Result{}, ErrRefused
	}

	var text strings.Builder
	for _, block := range response.Content {
		if part, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(part.Text)
		}
	}
	return parseResult(text.String())
}

func describeRequest(request Request) string {
	profile := request.Profile
	profile.Audit = ""
	text := fmt.Sprintf("Скриншотов: %d.\n\n%s", len(request.Images), strategy.DescribeProfile(profile))
	if extra := strings.TrimSpace(request.Extra); extra != "" {
		text += "\n" + extra + "\n"
	}
	return text
}

type rawResult struct {
	Result
	Unreadable string `json:"unreadable"`
}

func parseResult(raw string) (Result, error) {
	parsed, found := lastObject(raw)
	if !found {
		return Result{}, ErrBadAudit
	}
	if reason := strings.TrimSpace(parsed.Unreadable); reason != "" {
		return Result{}, &UnreadableError{Reason: truncateRunes(reason, MaxReasonRunes)}
	}
	return normalize(parsed.Result)
}

func normalize(result Result) (Result, error) {
	result.Summary = truncateRunes(strings.TrimSpace(result.Summary), MaxSummaryRunes)
	result.Strengths = cleanList(result.Strengths)
	result.Problems = cleanList(result.Problems)
	result.Fixes = cleanList(result.Fixes)
	result.ContentNotes = cleanList(result.ContentNotes)
	result.Missing = cleanList(result.Missing)
	result.BioSuggestion = truncateRunes(strings.TrimSpace(result.BioSuggestion), MaxBioRunes)
	result.NameSuggestion = truncateRunes(strings.TrimSpace(result.NameSuggestion), MaxNameRunes)

	if result.Summary == "" || len(result.Fixes) == 0 {
		return Result{}, ErrBadAudit
	}
	return result, nil
}

func lastObject(raw string) (rawResult, bool) {
	var result rawResult
	found := false
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var candidate rawResult
		if err := decoder.Decode(&candidate); err == nil && (strings.TrimSpace(candidate.Summary) != "" || strings.TrimSpace(candidate.Unreadable) != "") {
			result, found = candidate, true
			offset = start + int(decoder.InputOffset())
			continue
		}
		offset = start + 1
	}
	return result, found
}

func cleanList(items []string) []string {
	cleaned := make([]string, 0, MaxListItems)
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		cleaned = append(cleaned, truncateRunes(item, MaxItemRunes))
		if len(cleaned) == MaxListItems {
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
