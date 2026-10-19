package chat

import (
	"context"
	"errors"
)

type Role string

type Turn struct {
	Role Role   `json:"role"`
	Text string `json:"text"`
}

type Attachment struct {
	Name string
	Data []byte
}

type Conversation struct {
	History     []Turn
	Text        string
	Attachments []Attachment
}

type Responder interface {
	Reply(ctx context.Context, conversation Conversation) (string, error)
}

var (
	ErrUnsupportedAttachment = errors.New("unsupported attachment")
	ErrEmptyReply            = errors.New("empty reply")
)
