package feedback

import (
	"context"
	"sync"
	"time"
)

type Memory struct {
	mu       sync.Mutex
	messages []Message
}

func NewMemory() *Memory {
	return &Memory{}
}

func (m *Memory) Add(_ context.Context, message Message) (Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, message)
	return message, nil
}

func (m *Memory) CountSince(_ context.Context, masterID string, since time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, message := range m.messages {
		if message.MasterID == masterID && !message.CreatedAt.Before(since) {
			count++
		}
	}
	return count, nil
}

func (m *Memory) List(_ context.Context, limit int) ([]Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	listed := make([]Message, 0, len(m.messages))
	for index := len(m.messages) - 1; index >= 0 && len(listed) < limit; index-- {
		listed = append(listed, m.messages[index])
	}
	return listed, nil
}
