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

type memoryEvent struct {
	masterID string
	Event
}

type Memory struct {
	mu          sync.Mutex
	masters     map[string]*memoryMaster
	states      map[string]State
	history     map[string][]StateSnapshot
	events      []memoryEvent
	usage       []usageRecord
	nextEventID int64
	jobs        []*AuditJob
	identities  []memoryIdentity
	tokens      []memoryToken
	HistoryKeep int
}

type memoryMaster struct {
	Master
	codeHash string
}

func NewMemory() *Memory {
	return &Memory{
		masters:     map[string]*memoryMaster{},
		states:      map[string]State{},
		history:     map[string][]StateSnapshot{},
		HistoryKeep: DefaultHistoryKeep,
	}
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
	for _, token := range m.tokens {
		if token.hash == codeHash {
			if master, ok := m.masters[token.masterID]; ok {
				return master.Master, nil
			}
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

func (m *Memory) GetMaster(_ context.Context, id string) (Master, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[id]
	if !ok {
		return Master{}, ErrNotFound
	}
	return master.Master, nil
}

func (m *Memory) SetLocation(_ context.Context, id, city, timezone string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[id]
	if !ok {
		return ErrNotFound
	}
	master.City, master.Timezone = city, timezone
	return nil
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

func (m *Memory) RenameMaster(_ context.Context, id, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[id]
	if !ok {
		return ErrNotFound
	}
	master.Name = name
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
	m.history[id] = append(m.history[id], StateSnapshot{Version: next.Version, SavedAt: at, Data: slices.Clone(data)})
	if keep := m.HistoryKeep; keep > 0 && len(m.history[id]) > keep {
		m.history[id] = slices.Clone(m.history[id][len(m.history[id])-keep:])
	}
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

func (m *Memory) RecordEvent(_ context.Context, id, kind string, payload json.RawMessage, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextEventID++
	m.events = append(m.events, memoryEvent{
		masterID: id,
		Event:    Event{ID: m.nextEventID, Kind: kind, Payload: slices.Clone(payload), CreatedAt: at},
	})
	return nil
}

func (m *Memory) ListEvents(_ context.Context, id string, limit int) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	events := []Event{}
	for i := len(m.events) - 1; i >= 0 && (limit <= 0 || len(events) < limit); i-- {
		if m.events[i].masterID == id {
			events = append(events, m.events[i].Event)
		}
	}
	return events, nil
}

func (m *Memory) StateVersions(_ context.Context, id string, limit int) ([]StateVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	versions := []StateVersion{}
	history := m.history[id]
	for i := len(history) - 1; i >= 0 && (limit <= 0 || len(versions) < limit); i-- {
		versions = append(versions, StateVersion{Version: history[i].Version, SavedAt: history[i].SavedAt, Size: len(history[i].Data)})
	}
	return versions, nil
}

func (m *Memory) StateSnapshot(_ context.Context, id string, version int) (StateSnapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, snapshot := range m.history[id] {
		if snapshot.Version == version {
			return StateSnapshot{Version: snapshot.Version, SavedAt: snapshot.SavedAt, Data: slices.Clone(snapshot.Data)}, nil
		}
	}
	return StateSnapshot{}, ErrNotFound
}

func (m *Memory) ExportMaster(_ context.Context, id string) (Export, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[id]
	if !ok {
		return Export{}, ErrNotFound
	}
	export := Export{ExportedAt: time.Now(), Master: master.Master, History: slices.Clone(m.history[id]), Events: []Event{}}
	if state, ok := m.states[id]; ok {
		export.State = &state
	}
	for _, event := range m.events {
		if event.masterID == id {
			export.Events = append(export.Events, event.Event)
		}
	}
	return export, nil
}

func (m *Memory) DeleteMaster(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.masters[id]; !ok {
		return ErrNotFound
	}
	delete(m.masters, id)
	delete(m.states, id)
	delete(m.history, id)
	m.jobs = slices.DeleteFunc(m.jobs, func(job *AuditJob) bool { return job.MasterID == id })
	m.events = slices.DeleteFunc(m.events, func(event memoryEvent) bool { return event.masterID == id })
	m.usage = slices.DeleteFunc(m.usage, func(record usageRecord) bool { return record.masterID == id })
	m.identities = slices.DeleteFunc(m.identities, func(identity memoryIdentity) bool { return identity.masterID == id })
	m.tokens = slices.DeleteFunc(m.tokens, func(token memoryToken) bool { return token.masterID == id })
	return nil
}

func (m *Memory) Purge(_ context.Context, before time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var removed int64
	countOld := func(at time.Time) bool {
		if at.Before(before) {
			removed++
			return true
		}
		return false
	}
	m.events = slices.DeleteFunc(m.events, func(event memoryEvent) bool { return countOld(event.CreatedAt) })
	m.usage = slices.DeleteFunc(m.usage, func(record usageRecord) bool { return countOld(record.at) })
	for id, history := range m.history {
		if len(history) <= 1 {
			continue
		}
		last := history[len(history)-1]
		kept := slices.DeleteFunc(slices.Clone(history[:len(history)-1]), func(snapshot StateSnapshot) bool { return countOld(snapshot.SavedAt) })
		m.history[id] = append(kept, last)
	}
	return removed, nil
}

func (m *Memory) CreateAuditJob(_ context.Context, masterID, handle string, at time.Time) (AuditJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	master, ok := m.masters[masterID]
	if !ok {
		return AuditJob{}, ErrNotFound
	}
	for _, job := range m.jobs {
		if job.MasterID == masterID && (job.Status == JobQueued || job.Status == JobRunning) {
			return *job, ErrJobActive
		}
	}
	id, err := newID()
	if err != nil {
		return AuditJob{}, err
	}
	job := &AuditJob{ID: id, MasterID: masterID, MasterName: master.Name, Handle: handle, Status: JobQueued, CreatedAt: at}
	m.jobs = append(m.jobs, job)
	return *job, nil
}

func (m *Memory) LatestAuditJob(_ context.Context, masterID string) (AuditJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.jobs) - 1; i >= 0; i-- {
		if m.jobs[i].MasterID == masterID {
			return *m.jobs[i], nil
		}
	}
	return AuditJob{}, ErrNotFound
}

func (m *Memory) AuditJob(_ context.Context, id string) (AuditJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.jobs {
		if job.ID == id {
			return *job, nil
		}
	}
	return AuditJob{}, ErrNotFound
}

func (m *Memory) ClaimAuditJob(_ context.Context, now time.Time, lease time.Duration) (AuditJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.jobs {
		expired := job.Status == JobRunning && now.Sub(job.ClaimedAt) > lease
		if job.Status != JobQueued && !expired {
			continue
		}
		if expired && job.Attempts >= MaxJobAttempts {
			job.Status = JobFailed
			job.FinishedAt = now
			job.Error = "агент не вернул результат"
			continue
		}
		job.Status = JobRunning
		job.ClaimedAt = now
		job.Attempts++
		return *job, nil
	}
	return AuditJob{}, ErrNotFound
}

func (m *Memory) findRunning(id string) (*AuditJob, error) {
	for _, job := range m.jobs {
		if job.ID == id {
			if job.Status != JobRunning {
				return job, ErrJobState
			}
			return job, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) CompleteAuditJob(_ context.Context, id string, result json.RawMessage, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, err := m.findRunning(id)
	if err != nil {
		return err
	}
	job.Status = JobDone
	job.FinishedAt = at
	job.Error = ""
	job.Result = slices.Clone(result)
	return nil
}

func (m *Memory) FailAuditJob(_ context.Context, id, reason string, final bool, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, err := m.findRunning(id)
	if err != nil {
		return err
	}
	job.Error = reason
	if final || job.Attempts >= MaxJobAttempts {
		job.Status = JobFailed
		job.FinishedAt = at
		return nil
	}
	job.Status = JobQueued
	return nil
}

func (m *Memory) CancelAuditJob(_ context.Context, masterID, id string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.jobs {
		if job.ID != id || job.MasterID != masterID {
			continue
		}
		if job.Status != JobQueued && job.Status != JobRunning {
			return ErrJobState
		}
		job.Status = JobCanceled
		job.FinishedAt = at
		return nil
	}
	return ErrNotFound
}

func (m *Memory) ListAuditJobs(_ context.Context, limit int) ([]AuditJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	jobs := []AuditJob{}
	for i := len(m.jobs) - 1; i >= 0 && (limit <= 0 || len(jobs) < limit); i-- {
		job := *m.jobs[i]
		job.Result = nil
		jobs = append(jobs, job)
	}
	return jobs, nil
}
