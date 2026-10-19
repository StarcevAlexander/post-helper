package chat

import (
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
)

func buildMessages(conversation Conversation) ([]anthropic.MessageParam, error) {
	messages := historyMessages(conversation.History)

	attachmentBlocks, err := buildAttachmentBlocks(conversation.Attachments)
	if err != nil {
		return nil, err
	}
	blocks := attachmentBlocks
	if text := strings.TrimSpace(conversation.Text); text != "" {
		blocks = append(blocks, anthropic.NewTextBlock(text))
	}
	return append(messages, anthropic.NewUserMessage(blocks...)), nil
}

func historyMessages(history []Turn) []anthropic.MessageParam {
	if len(history) > MaxHistoryTurns {
		history = history[len(history)-MaxHistoryTurns:]
	}

	messages := make([]anthropic.MessageParam, 0, len(history))
	for _, turn := range history {
		text := strings.TrimSpace(turn.Text)
		if text == "" {
			continue
		}
		switch turn.Role {
		case RoleUser:
			messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock(text)))
		case RoleAssistant:
			if len(messages) == 0 {
				continue
			}
			messages = append(messages, anthropic.NewAssistantMessage(anthropic.NewTextBlock(text)))
		}
	}
	return messages
}
