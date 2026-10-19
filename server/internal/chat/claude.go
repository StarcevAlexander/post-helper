package chat

import (
	"context"
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
	return &Claude{
		client: anthropic.NewClient(allOptions...),
		model:  model,
	}
}

func (c *Claude) Reply(ctx context.Context, conversation Conversation) (string, error) {
	messages, err := buildMessages(conversation)
	if err != nil {
		return "", err
	}

	response, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    MaxOutputTokens,
		System:       []anthropic.TextBlockParam{{Text: SystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium},
		Messages:     messages,
	})
	if err != nil {
		return "", fmt.Errorf("claude request: %w", err)
	}

	if response.StopReason == anthropic.StopReasonRefusal {
		return RefusalReply, nil
	}

	var reply strings.Builder
	for _, block := range response.Content {
		if text, ok := block.AsAny().(anthropic.TextBlock); ok {
			reply.WriteString(text.Text)
		}
	}
	if strings.TrimSpace(reply.String()) == "" {
		return "", ErrEmptyReply
	}
	return strings.TrimSpace(reply.String()), nil
}
