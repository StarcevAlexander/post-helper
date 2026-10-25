package digest

import (
	"context"
	"sync"
	"time"
)

type Memory struct {
	mu   sync.Mutex
	sent map[string]time.Time
}

func NewMemory() *Memory {
	return &Memory{sent: map[string]time.Time{}}
}

func (m *Memory) Has(_ context.Context, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sent[key]
	return ok, nil
}

func (m *Memory) Mark(_ context.Context, key string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent[key] = at
	return nil
}
