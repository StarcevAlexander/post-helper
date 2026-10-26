package notices

import (
	"context"
	"slices"
	"sync"
	"time"
)

type Memory struct {
	mu      sync.Mutex
	entries []Entry
}

func NewMemory() *Memory {
	return &Memory{}
}

func (m *Memory) Add(_ context.Context, entry Entry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry.Topic.ItemIDs = slices.Clone(entry.Topic.ItemIDs)
	m.entries = append(m.entries, entry)
	return nil
}

func (m *Memory) List(_ context.Context, masterID string, limit int) ([]Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entries := []Entry{}
	for index := len(m.entries) - 1; index >= 0 && len(entries) < limit; index-- {
		if m.entries[index].MasterID == masterID {
			entries = append(entries, m.entries[index])
		}
	}
	return entries, nil
}

func (m *Memory) Get(_ context.Context, masterID, id string) (Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, entry := range m.entries {
		if entry.ID == id && entry.MasterID == masterID {
			return entry, nil
		}
	}
	return Entry{}, ErrNotFound
}

func (m *Memory) Purge(_ context.Context, before time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.entries[:0]
	for _, entry := range m.entries {
		if !entry.SentAt.Before(before) {
			kept = append(kept, entry)
		}
	}
	removed := int64(len(m.entries) - len(kept))
	m.entries = kept
	return removed, nil
}
