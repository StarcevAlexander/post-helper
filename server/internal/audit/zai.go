package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"post-helper/server/internal/zai"
)

type Zai struct {
	client *zai.Client
	model  string
}

func NewZai(client *zai.Client, model string) *Zai {
	return &Zai{client: client, model: model}
}

func (z *Zai) Generate(ctx context.Context, request Request) (Result, error) {
	images := make([]zai.Image, 0, len(request.Images))
	for _, image := range request.Images {
		images = append(images, zai.Image{MediaType: image.MediaType, Data: image.Data})
	}
	text, err := z.client.Complete(ctx, zai.Request{
		Model:           z.model,
		System:          SystemPrompt,
		Text:            describeRequest(request),
		Images:          images,
		MaxTokens:       int(MaxOutputTokens),
		ReasoningEffort: ReasoningEffort,
	})
	if errors.Is(err, zai.ErrRefused) {
		return Result{}, ErrRefused
	}
	if err != nil {
		return Result{}, fmt.Errorf("zai audit request: %w", err)
	}
	return parseResult(text)
}

func describeRequest(request Request) string {
	text := fmt.Sprintf("Скриншотов: %d.\n\n%s", len(request.Images), request.About)
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
