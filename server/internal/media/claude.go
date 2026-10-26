package media

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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

func (c *Claude) Plan(ctx context.Context, request Request) (Plan, error) {
	blocks := make([]anthropic.ContentBlockParamUnion, 0, 2)
	if len(request.Preview) > 0 {
		blocks = append(blocks, anthropic.NewImageBlockBase64(PreviewMediaType, base64.StdEncoding.EncodeToString(request.Preview)))
	}
	blocks = append(blocks, anthropic.NewTextBlock(describeRequest(request)))
	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(blocks...)},
	})
	if err != nil {
		return Plan{}, fmt.Errorf("claude media request: %w", err)
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
	plan, err := parseFor(text.String(), request)
	if err != nil {
		return Plan{}, err
	}
	if strings.TrimSpace(request.Item.Note) == "" {
		plan.Caption = ""
	}
	return plan, nil
}

func describeRequest(request Request) string {
	var text strings.Builder
	text.WriteString(request.About)
	kind := "фото"
	if request.Item.Kind == KindVideo {
		kind = "видео"
	}
	fmt.Fprintf(&text, "\nПункт плана:\nФормат публикации: %s\nРубрика: %s\nИдея: %s\n", request.Item.Format, request.Item.Pillar, request.Item.Idea)
	if overlay := strings.TrimSpace(request.Item.Overlay); overlay != "" {
		fmt.Fprintf(&text, "Текст на кадре из комплекта: %s\n", overlay)
	}
	if note := strings.TrimSpace(request.Item.Note); note != "" {
		fmt.Fprintf(&text, "Текст мастера для подписи:\n%s\n", Truncate(note, MaxMasterNote))
	} else {
		text.WriteString("Текста мастера нет: caption оставь пустой строкой.\n")
	}
	if wish := strings.TrimSpace(request.Item.Wish); wish != "" {
		fmt.Fprintf(&text, "Мастер уже видел прошлую обработку и просит переделать: %s\nЭто пожелание важнее твоих обычных правил: выполни его, если оно выполнимо пресетом, кадрированием, заголовком, субтитрами или подписью.\n", wish)
	} else if request.Item.Redos > 0 {
		text.WriteString("Мастер попросил переделать прошлую обработку без пояснений: попробуй другой пресет, другое кадрирование и другой заголовок.\n")
	}
	fmt.Fprintf(&text, "\nФайл: %s, %d×%d", kind, request.Width, request.Height)
	if request.DurationMs > 0 {
		fmt.Fprintf(&text, ", %.1f с", float64(request.DurationMs)/1000)
	}
	text.WriteString("\n")
	if len(request.Segments) == 0 {
		text.WriteString("Речи в файле нет.\n")
		return text.String()
	}
	text.WriteString("Расшифровка речи (секунды от начала):\n")
	for _, segment := range request.Segments {
		fmt.Fprintf(&text, "[%.2f - %.2f] %s\n", segment.Start, segment.End, segment.Text)
	}
	return text.String()
}

func parseFor(raw string, request Request) (Plan, error) {
	plan, err := ParsePlan(raw, request.Segments)
	if errors.Is(err, ErrBadPlan) && strings.TrimSpace(request.Item.Wish) != "" {
		return ParsePlan(raw, nil)
	}
	return plan, err
}

func ParsePlan(raw string, segments []Segment) (Plan, error) {
	source := CleanSegments(segments)
	for offset := 0; offset < len(raw); {
		start := strings.IndexByte(raw[offset:], '{')
		if start < 0 {
			break
		}
		start += offset
		var candidate Plan
		if err := json.NewDecoder(strings.NewReader(raw[start:])).Decode(&candidate); err == nil && candidate.Preset != "" {
			return normalize(candidate, source)
		}
		offset = start + 1
	}
	return Plan{}, ErrBadPlan
}

func normalize(plan Plan, source []Segment) (Plan, error) {
	plan.Preset = strings.ToLower(strings.TrimSpace(plan.Preset))
	plan.Focus = strings.ToLower(strings.TrimSpace(plan.Focus))
	if !ValidPreset(plan.Preset) || !ValidFocus(plan.Focus) {
		return Plan{}, ErrBadPlan
	}
	plan.Title = Truncate(strings.TrimSpace(plan.Title), MaxTitleRunes)
	plan.Note = Truncate(strings.TrimSpace(plan.Note), MaxNoteRunes)
	if plan.Note == "" {
		plan.Note = DefaultNote
	}
	plan.Caption = Truncate(strings.TrimSpace(plan.Caption), MaxCaptionRunes)
	if len(plan.Subtitles) > MaxSegments {
		return Plan{}, ErrBadPlan
	}
	cleaned := make([]Segment, 0, len(plan.Subtitles))
	for _, segment := range plan.Subtitles {
		segment.Text = strings.TrimSpace(segment.Text)
		if segment.Text == "" {
			continue
		}
		if segment.Start < 0 || segment.End <= segment.Start || !within(segment, source) {
			return Plan{}, ErrBadPlan
		}
		segment.Text = Truncate(segment.Text, MaxSubtitleRunes)
		cleaned = append(cleaned, segment)
	}
	if len(source) > 0 && len(cleaned) == 0 {
		return Plan{}, ErrBadPlan
	}
	plan.Subtitles = cleaned
	plan.Source = PlanSourceClaude
	return plan, nil
}

func within(segment Segment, source []Segment) bool {
	if len(source) == 0 {
		return false
	}
	first, last := source[0].Start, source[0].End
	for _, item := range source {
		first = min(first, item.Start)
		last = max(last, item.End)
	}
	return segment.Start >= first-TimeTolerance && segment.End <= last+TimeTolerance
}
