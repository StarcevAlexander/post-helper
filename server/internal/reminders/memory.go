package reminders

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

func (m *Memory) Has(_ context.Context, masterID, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sent[masterID+"|"+key]
	return ok, nil
}

func (m *Memory) Mark(_ context.Context, masterID, key string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent[masterID+"|"+key] = at
	return nil
}

func (m *Memory) Forget(_ context.Context, before time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, at := range m.sent {
		if at.Before(before) {
			delete(m.sent, key)
		}
	}
	return nil
}
