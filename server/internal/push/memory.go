package push

import (
	"context"
	"sort"
	"sync"
	"time"
)

type memoryEntry struct {
	masterID     string
	subscription Subscription
	createdAt    time.Time
}

type Memory struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
}

func NewMemory() *Memory {
	return &Memory{entries: map[string]memoryEntry{}}
}

func (m *Memory) Save(_ context.Context, masterID string, subscription Subscription, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[subscription.Endpoint] = memoryEntry{masterID: masterID, subscription: subscription, createdAt: now}

	owned := m.ownedLocked(masterID)
	for _, stale := range owned[min(len(owned), MaxSubscriptionsPerMaster):] {
		delete(m.entries, stale.subscription.Endpoint)
	}
	return nil
}

func (m *Memory) Remove(_ context.Context, masterID, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if entry, ok := m.entries[endpoint]; ok && entry.masterID == masterID {
		delete(m.entries, endpoint)
	}
	return nil
}

func (m *Memory) RemoveEndpoint(_ context.Context, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entries, endpoint)
	return nil
}

func (m *Memory) List(_ context.Context, masterID string) ([]Subscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	owned := m.ownedLocked(masterID)
	subscriptions := make([]Subscription, 0, len(owned))
	for _, entry := range owned {
		subscriptions = append(subscriptions, entry.subscription)
	}
	return subscriptions, nil
}

func (m *Memory) ownedLocked(masterID string) []memoryEntry {
	var owned []memoryEntry
	for _, entry := range m.entries {
		if entry.masterID == masterID {
			owned = append(owned, entry)
		}
	}
	sort.Slice(owned, func(i, j int) bool { return owned[i].createdAt.After(owned[j].createdAt) })
	return owned
}
