package intake

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"sort"
	"sync"
	"time"
)

type Memory struct {
	mu       sync.Mutex
	requests []*Request
}

func NewMemory() *Memory {
	return &Memory{}
}

func newID() string {
	buffer := make([]byte, 8)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}

func (m *Memory) Submit(_ context.Context, masterID string, draft Draft, now time.Time) (Request, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current := m.latest(masterID); current != nil && current.Status == StatusNew {
		current.Networks = slices.Clone(draft.Networks)
		current.References = slices.Clone(draft.References)
		current.Goals = slices.Clone(draft.Goals)
		current.Note = draft.Note
		current.UpdatedAt = now
		return *current, true, nil
	}
	created := &Request{
		ID: newID(), MasterID: masterID, Networks: slices.Clone(draft.Networks), References: slices.Clone(draft.References),
		Goals: slices.Clone(draft.Goals), Note: draft.Note, Status: StatusNew, CreatedAt: now, UpdatedAt: now,
	}
	m.requests = append(m.requests, created)
	return *created, false, nil
}

func (m *Memory) Latest(_ context.Context, masterID string) (Request, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current := m.latest(masterID); current != nil {
		return *current, nil
	}
	return Request{}, ErrNotFound
}

func (m *Memory) List(_ context.Context, status string, limit int) ([]Request, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	listed := make([]Request, 0, len(m.requests))
	for _, stored := range m.requests {
		if status == "" || stored.Status == status {
			listed = append(listed, *stored)
		}
	}
	sort.Slice(listed, func(a, b int) bool { return listed[a].CreatedAt.After(listed[b].CreatedAt) })
	if limit > 0 && len(listed) > limit {
		listed = listed[:limit]
	}
	return listed, nil
}

func (m *Memory) Ready(_ context.Context, masterID, replyNote string, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.latest(masterID)
	if current == nil {
		return ErrNotFound
	}
	current.Status, current.ReplyNote, current.UpdatedAt, current.ReadyAt = StatusReady, replyNote, now, now
	return nil
}

func (m *Memory) latest(masterID string) *Request {
	var found *Request
	for _, stored := range m.requests {
		if stored.MasterID == masterID && (found == nil || !stored.CreatedAt.Before(found.CreatedAt)) {
			found = stored
		}
	}
	return found
}
