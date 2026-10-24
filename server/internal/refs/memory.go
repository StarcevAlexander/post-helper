package refs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

type memoryItem struct {
	Item
	files []File
}

type Memory struct {
	mu    sync.Mutex
	items map[string]*memoryItem
}

func NewMemory() *Memory {
	return &Memory{items: map[string]*memoryItem{}}
}

func newID() string {
	buffer := make([]byte, 8)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}

func (m *Memory) Sync(_ context.Context, masterID string, items []OrderItem, now time.Time) (int, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	wanted := make(map[string]OrderItem, len(items))
	for _, item := range items {
		wanted[item.Key] = item
	}
	added, removed := 0, 0
	for id, stored := range m.items {
		if stored.MasterID != masterID {
			continue
		}
		item, keep := wanted[stored.Key]
		if !keep {
			delete(m.items, id)
			removed++
			continue
		}
		stored.Date = item.Date
		if item.Format != stored.Format || item.Idea != stored.Idea || item.Pillar != stored.Pillar {
			stored.Format, stored.Idea, stored.Pillar = item.Format, item.Idea, item.Pillar
			stored.Status, stored.Attempts, stored.Error, stored.files = StatusQueued, 0, "", nil
			added++
		}
		delete(wanted, stored.Key)
	}
	for _, item := range items {
		if _, fresh := wanted[item.Key]; !fresh {
			continue
		}
		delete(wanted, item.Key)
		id := newID()
		m.items[id] = &memoryItem{Item: Item{
			ID: id, MasterID: masterID, Key: item.Key, Format: item.Format, Pillar: item.Pillar,
			Idea: item.Idea, Date: item.Date, Status: StatusQueued, CreatedAt: now,
		}}
		added++
	}
	return added, removed, nil
}

func (m *Memory) Statuses(_ context.Context, masterID string, now time.Time) ([]Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	statuses := []Status{}
	for _, stored := range m.items {
		if stored.MasterID != masterID {
			continue
		}
		files := make([]FileMeta, 0, len(stored.files))
		for _, file := range stored.files {
			files = append(files, FileMeta{
				ID: file.ID, Index: file.Index, Kind: file.Kind, MediaType: file.MediaType,
				Caption: file.Caption, Size: len(file.Data),
			})
		}
		sort.Slice(files, func(a, b int) bool { return files[a].Index < files[b].Index })
		statuses = append(statuses, Status{
			Key: stored.Key, Status: stored.Status, Kind: KindPhoto, Date: stored.Date,
			Stale: isStale(stored.Item, now), Error: stored.Error, Files: files,
		})
	}
	sort.Slice(statuses, func(a, b int) bool { return statuses[a].Key < statuses[b].Key })
	return statuses, nil
}

func (m *Memory) File(_ context.Context, masterID, fileID string) (File, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, stored := range m.items {
		if stored.MasterID != masterID {
			continue
		}
		for _, file := range stored.files {
			if file.ID == fileID {
				return file, nil
			}
		}
	}
	return File{}, ErrNotFound
}

func (m *Memory) Claim(_ context.Context, now time.Time, lease time.Duration) (Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	blocked := map[string]bool{}
	for _, stored := range m.items {
		if isStale(stored.Item, now) {
			blocked[stored.MasterID] = true
		}
	}
	var chosen *memoryItem
	for _, stored := range m.items {
		expired := stored.Status == StatusRunning && now.Sub(stored.ClaimedAt) > lease
		if expired && stored.Attempts >= MaxAttempts {
			stored.Status, stored.FinishedAt, stored.Error = StatusFailed, now, "агент не вернул результат"
			continue
		}
		if (stored.Status != StatusQueued && !expired) || blocked[stored.MasterID] {
			continue
		}
		if chosen == nil || stored.CreatedAt.Before(chosen.CreatedAt) ||
			(stored.CreatedAt.Equal(chosen.CreatedAt) && stored.Key < chosen.Key) {
			chosen = stored
		}
	}
	if chosen == nil {
		return Item{}, ErrNotFound
	}
	chosen.Status, chosen.ClaimedAt = StatusRunning, now
	chosen.Attempts++
	return chosen.Item, nil
}

func (m *Memory) Complete(_ context.Context, id string, files []File, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return ErrNotFound
	}
	if stored.Status != StatusRunning {
		return ErrState
	}
	stored.files = make([]File, 0, len(files))
	for _, file := range files {
		file.ID = newID()
		stored.files = append(stored.files, file)
	}
	stored.Status, stored.FinishedAt, stored.Error = StatusDone, now, ""
	return nil
}

func (m *Memory) Fail(_ context.Context, id, reason string, final bool, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.items[id]
	if !ok {
		return ErrNotFound
	}
	if stored.Status != StatusRunning {
		return ErrState
	}
	stored.Error = reason
	if final || stored.Attempts >= MaxAttempts {
		stored.Status, stored.FinishedAt = StatusFailed, now
		return nil
	}
	stored.Status = StatusQueued
	return nil
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

func (m *Memory) DeleteMaster(_ context.Context, masterID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, stored := range m.items {
		if stored.MasterID == masterID {
			delete(m.items, id)
		}
	}
	return nil
}

func isStale(item Item, now time.Time) bool {
	if item.Status != StatusDone || item.Date == "" {
		return false
	}
	planned, err := time.Parse(DateLayout, item.Date)
	return err == nil && now.Sub(planned) >= time.Duration(staleDays())*24*time.Hour
}

func (m *Memory) Deliver(_ context.Context, masterID string, item OrderItem, files []File, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var target *memoryItem
	for _, stored := range m.items {
		if stored.MasterID == masterID && stored.Key == item.Key {
			target = stored
			break
		}
	}
	if target == nil {
		id := newID()
		target = &memoryItem{Item: Item{ID: id, MasterID: masterID, Key: item.Key, CreatedAt: now}}
		m.items[id] = target
	}
	target.Format, target.Pillar, target.Idea, target.Date = item.Format, item.Pillar, item.Idea, item.Date
	target.Status, target.Attempts, target.Error, target.FinishedAt = StatusDone, 0, "", now
	target.files = make([]File, 0, len(files))
	for _, file := range files {
		file.ID = newID()
		target.files = append(target.files, file)
	}
	return nil
}

func (m *Memory) Confirm(_ context.Context, masterID, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, stored := range m.items {
		if stored.MasterID != masterID || stored.Key != key {
			continue
		}
		if stored.Status == StatusRunning {
			return ErrState
		}
		stored.Status, stored.files, stored.Error = StatusMade, nil, ""
		return nil
	}
	return ErrNotFound
}
