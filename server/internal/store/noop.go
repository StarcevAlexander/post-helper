package store

import (
	"context"
	"time"
)

type Noop struct{}

func (Noop) SaveMessages([]Message)        {}
func (Noop) SaveEvent(string, string, any) {}
func (Noop) SaveError(string, string, any) {}
func (Noop) Close()                        {}

func (Noop) Messages(context.Context, MessageFilter) ([]Message, error) {
	return []Message{}, nil
}

func (Noop) Events(context.Context, string, int) ([]Event, error) {
	return []Event{}, nil
}

func (Noop) Errors(context.Context, int) ([]ErrorEntry, error) {
	return []ErrorEntry{}, nil
}

func timeAfter(d time.Duration) <-chan time.Time {
	return time.After(d)
}

func nullTime(m Message) *time.Time {
	if m.CreatedAt.IsZero() {
		return nil
	}
	return &m.CreatedAt
}
