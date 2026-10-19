package accounts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"sync"
	"time"
)

type usageRecord struct {
	masterID string
	at       time.Time
}

type Memory struct {
	mu      sync.Mutex
	masters map[string]*memoryMaster
	states  map[string]State
	usage   []usageRecord
}

type memoryMaster struct {
	Master
	codeHash string
}

func NewMemory() *Memory {
	return &Memory{masters: map[string]*memoryMaster{}, states: map[string]State{}}
}

func newID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func (m *Memory) CreateMaster(_ context.Context, name, codeHash string) (Master, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, err := newID()
	if err != nil {
		return Master{}, err
	}
	master := Master{ID: id, Name: name, CreatedAt: time.Now()}
	m.masters[id] = &memoryMaster{Master: master, codeHash: codeHash}
	return master, nil
}

func (m *Memory) FindByCodeHash(_ context.Context, codeHash string) (Master, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, master := range m.masters {
		if master.codeHash == codeHash {
			return master.Master, nil
		}
	}
	return Master{}, ErrNotFound
}

func (m *Memory) ListMasters(_ context.Context, since time.Time) ([]MasterSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	summaries := make([]MasterSummary, 0, len(m.masters))
	for _, master := range m.masters {
		summary := MasterSummary{Master: master.Master}
		for _, record := range m.usage {
			if record.masterID != master.ID {
				continue
			}
			summary.UsageTotal++
			if !record.at.Before(since) {
				summary.UsageToday++
			}
		}
		summaries = append(summaries, summary)
	}
	slices.SortFunc(summaries, func(a, b MasterSummary) int {
		if byTime := a.CreatedAt.Compare(b.CreatedAt); byTime != 0 {
			return byTime
		}
		return strings.Compare(a.ID, b.ID)
	})
	return summaries, nil
}

func (m *Memory) SetDisabled(_ context.Context, id string, disabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[id]
	if !ok {
		return ErrNotFound
	}
	master.Disabled = disabled
	return nil
}

func (m *Memory) Touch(_ context.Context, id string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if master, ok := m.masters[id]; ok {
		master.LastSeenAt = at
	}
	return nil
}

func (m *Memory) LoadState(_ context.Context, id string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.states[id]
	if !ok {
		return State{}, ErrNotFound
	}
	return state, nil
}

func (m *Memory) SaveState(_ context.Context, id string, baseVersion int, data json.RawMessage, at time.Time) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.states[id]
	if current.Version != baseVersion {
		return current, ErrConflict
	}
	next := State{Version: baseVersion + 1, Data: slices.Clone(data), UpdatedAt: at}
	m.states[id] = next
	return next, nil
}

func (m *Memory) CountUsage(_ context.Context, id string, since time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, record := range m.usage {
		if record.masterID == id && !record.at.Before(since) {
			count++
		}
	}
	return count, nil
}

func (m *Memory) RecordUsage(_ context.Context, id, _ string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usage = append(m.usage, usageRecord{masterID: id, at: at})
	return nil
}
