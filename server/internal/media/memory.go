package media

import (
	"bytes"
	"context"
	"io"
	"sort"
	"sync"
	"time"
)

type Memory struct {
	mu    sync.Mutex
	items map[string]*Item
}

func NewMemory() *Memory {
	return &Memory{items: map[string]*Item{}}
}

func (m *Memory) Create(_ context.Context, item Item, limit int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, stored := range m.items {
		if stored.MasterID == item.MasterID {
			count++
		}
	}
	if limit > 0 && count >= limit {
		return ErrTooMany
	}
	copied := item
	m.items[item.ID] = &copied
	return nil
}

func (m *Memory) List(_ context.Context, masterID string) ([]Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := []Item{}
	for _, stored := range m.items {
		if stored.MasterID == masterID {
			items = append(items, *stored)
		}
	}
	sort.Slice(items, func(a, b int) bool { return olderFirst(items[a], items[b]) })
	return items, nil
}

func olderFirst(a, b Item) bool {
	if a.CreatedAt.Equal(b.CreatedAt) {
		return a.ID < b.ID
	}
	return a.CreatedAt.Before(b.CreatedAt)
}

func (m *Memory) Get(_ context.Context, masterID, id string) (Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok || stored.MasterID != masterID {
		return Item{}, ErrNotFound
	}
	return *stored, nil
}

func (m *Memory) Find(_ context.Context, id string) (Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return Item{}, ErrNotFound
	}
	return *stored, nil
}

func (m *Memory) SetCaption(_ context.Context, id, caption string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return ErrNotFound
	}
	stored.Caption = caption
	return nil
}

func (m *Memory) Remove(_ context.Context, masterID, id string) (Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok || stored.MasterID != masterID {
		return Item{}, ErrNotFound
	}
	delete(m.items, id)
	return *stored, nil
}

func (m *Memory) Recent(_ context.Context, limit int) ([]Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := make([]Item, 0, len(m.items))
	for _, stored := range m.items {
		items = append(items, *stored)
	}
	sort.Slice(items, func(a, b int) bool { return olderFirst(items[b], items[a]) })
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (m *Memory) Expire(_ context.Context, now time.Time, lease time.Duration) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var refs []string
	for _, stored := range m.items {
		if stored.Status == StatusRunning && now.Sub(stored.ClaimedAt) > lease && stored.Attempts >= MaxAttempts {
			refs = appendRef(refs, stored.SourceRef)
			stored.Status, stored.FinishedAt, stored.Error, stored.SourceRef = StatusFailed, now, DefaultFailReason, ""
		}
	}
	return refs, nil
}

func (m *Memory) Claim(_ context.Context, now time.Time, lease time.Duration) (Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var chosen *Item
	for _, stored := range m.items {
		expired := stored.Status == StatusRunning && now.Sub(stored.ClaimedAt) > lease
		if stored.Status != StatusQueued && !expired {
			continue
		}
		if chosen == nil || olderFirst(*stored, *chosen) {
			chosen = stored
		}
	}
	if chosen == nil {
		return Item{}, ErrNotFound
	}
	chosen.Status, chosen.ClaimedAt = StatusRunning, now
	chosen.Attempts++
	return *chosen, nil
}

func (m *Memory) Complete(_ context.Context, id string, result Result, resultRef, thumbRef string, now time.Time) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return "", ErrNotFound
	}
	if stored.Status != StatusRunning {
		return "", ErrState
	}
	sourceRef := stored.SourceRef
	stored.Status, stored.FinishedAt, stored.Error = StatusDone, now, ""
	stored.Result, stored.ResultRef, stored.ThumbRef, stored.SourceRef = result, resultRef, thumbRef, ""
	return sourceRef, nil
}

func (m *Memory) Fail(_ context.Context, id, reason string, final bool, now time.Time) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return "", ErrNotFound
	}
	if stored.Status != StatusRunning {
		return "", ErrState
	}
	if final || stored.Attempts >= MaxAttempts {
		sourceRef := stored.SourceRef
		stored.Status, stored.FinishedAt, stored.Error, stored.SourceRef = StatusFailed, now, reason, ""
		return sourceRef, nil
	}
	stored.Status = StatusQueued
	return "", nil
}

func (m *Memory) Remaining(_ context.Context, masterID string) (int, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	active, done := 0, 0
	for _, stored := range m.items {
		if stored.MasterID != masterID {
			continue
		}
		switch stored.Status {
		case StatusQueued, StatusRunning:
			active++
		case StatusDone:
			done++
		}
	}
	return active, done, nil
}

func (m *Memory) MasterOf(_ context.Context, id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return "", ErrNotFound
	}
	return stored.MasterID, nil
}

func (m *Memory) Purge(_ context.Context, before time.Time) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var refs []string
	for id, stored := range m.items {
		if stored.Status != StatusDone && stored.Status != StatusFailed {
			continue
		}
		finished := stored.FinishedAt
		if finished.IsZero() {
			finished = stored.CreatedAt
		}
		if finished.Before(before) {
			refs = appendRef(refs, stored.SourceRef)
			refs = appendRef(refs, stored.ResultRef)
			refs = appendRef(refs, stored.ThumbRef)
			delete(m.items, id)
		}
	}
	return refs, nil
}

func appendRef(refs []string, ref string) []string {
	if ref == "" {
		return refs
	}
	return append(refs, ref)
}

type bytesFile struct {
	*bytes.Reader
}

func (bytesFile) Close() error { return nil }

type MemoryFiles struct {
	mu    sync.Mutex
	files map[string][]byte
}

func NewMemoryFiles() *MemoryFiles {
	return &MemoryFiles{files: map[string][]byte{}}
}

func (m *MemoryFiles) Put(_ context.Context, ref string, reader io.Reader, limit int64) (int64, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return 0, err
	}
	if int64(len(data)) > limit {
		return 0, ErrFileTooLarge
	}
	m.mu.Lock()
	m.files[ref] = data
	m.mu.Unlock()
	return int64(len(data)), nil
}

func (m *MemoryFiles) Open(_ context.Context, ref string) (io.ReadSeekCloser, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.files[ref]
	if !ok {
		return nil, 0, ErrNoFile
	}
	return bytesFile{bytes.NewReader(data)}, int64(len(data)), nil
}

func (m *MemoryFiles) Delete(_ context.Context, refs ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ref := range refs {
		delete(m.files, ref)
	}
	return nil
}

func (m *MemoryFiles) Has(ref string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.files[ref]
	return ok
}

func (m *MemoryFiles) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.files)
}
