package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool        *pgxpool.Pool
	HistoryKeep int
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, HistoryKeep: DefaultHistoryKeep}
}

func (p *Postgres) CreateMaster(ctx context.Context, name, codeHash string) (Master, error) {
	id, err := newID()
	if err != nil {
		return Master{}, err
	}
	master := Master{ID: id, Name: name}
	err = p.pool.QueryRow(ctx,
		`INSERT INTO masters (id, name, code_hash) VALUES ($1, $2, $3) RETURNING created_at`,
		id, name, codeHash).Scan(&master.CreatedAt)
	return master, err
}

func (p *Postgres) FindByCodeHash(ctx context.Context, codeHash string) (Master, error) {
	var master Master
	var lastSeen *time.Time
	err := p.pool.QueryRow(ctx,
		`SELECT id, name, created_at, last_seen_at, disabled, city, timezone FROM masters
		WHERE code_hash = $1 OR id IN (SELECT master_id FROM master_tokens WHERE token_hash = $1)
		LIMIT 1`,
		codeHash).Scan(&master.ID, &master.Name, &master.CreatedAt, &lastSeen, &master.Disabled, &master.City, &master.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return Master{}, ErrNotFound
	}
	if lastSeen != nil {
		master.LastSeenAt = *lastSeen
	}
	return master, err
}

func (p *Postgres) ListMasters(ctx context.Context, since time.Time) ([]MasterSummary, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT m.id, m.name, m.created_at, m.last_seen_at, m.disabled, m.city, m.timezone,
			COUNT(u.id) FILTER (WHERE u.created_at >= $1),
			COUNT(u.id)
		FROM masters m LEFT JOIN usage_log u ON u.master_id = m.id
		GROUP BY m.id ORDER BY m.created_at`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	summaries := []MasterSummary{}
	for rows.Next() {
		var summary MasterSummary
		var lastSeen *time.Time
		if err := rows.Scan(&summary.ID, &summary.Name, &summary.CreatedAt, &lastSeen, &summary.Disabled, &summary.City, &summary.Timezone, &summary.UsageToday, &summary.UsageTotal); err != nil {
			return nil, err
		}
		if lastSeen != nil {
			summary.LastSeenAt = *lastSeen
		}
		summaries = append(summaries, summary)
	}
	return summaries, rows.Err()
}

func (p *Postgres) GetMaster(ctx context.Context, id string) (Master, error) {
	var master Master
	var lastSeen *time.Time
	err := p.pool.QueryRow(ctx,
		`SELECT id, name, created_at, last_seen_at, disabled, city, timezone FROM masters WHERE id = $1`, id).
		Scan(&master.ID, &master.Name, &master.CreatedAt, &lastSeen, &master.Disabled, &master.City, &master.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return Master{}, ErrNotFound
	}
	if lastSeen != nil {
		master.LastSeenAt = *lastSeen
	}
	return master, err
}

func (p *Postgres) SetLocation(ctx context.Context, id, city, timezone string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE masters SET city = $2, timezone = $3 WHERE id = $1`, id, city, timezone)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) SetDisabled(ctx context.Context, id string, disabled bool) error {
	tag, err := p.pool.Exec(ctx, `UPDATE masters SET disabled = $2 WHERE id = $1`, id, disabled)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) RenameMaster(ctx context.Context, id, name string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE masters SET name = $2 WHERE id = $1`, id, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) Touch(ctx context.Context, id string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `UPDATE masters SET last_seen_at = $2 WHERE id = $1`, id, at)
	return err
}

func (p *Postgres) LoadState(ctx context.Context, id string) (State, error) {
	var state State
	err := p.pool.QueryRow(ctx,
		`SELECT version, data, updated_at FROM master_state WHERE master_id = $1`, id).
		Scan(&state.Version, &state.Data, &state.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return State{}, ErrNotFound
	}
	return state, err
}

func (p *Postgres) SaveState(ctx context.Context, id string, baseVersion int, data json.RawMessage, at time.Time) (State, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return State{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var saved State
	if baseVersion == 0 {
		err = tx.QueryRow(ctx, `
			INSERT INTO master_state (master_id, version, data, updated_at) VALUES ($1, 1, $2, $3)
			ON CONFLICT (master_id) DO NOTHING
			RETURNING version, data, updated_at`, id, data, at).Scan(&saved.Version, &saved.Data, &saved.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE master_state SET version = version + 1, data = $3, updated_at = $4
			WHERE master_id = $1 AND version = $2
			RETURNING version, data, updated_at`, id, baseVersion, data, at).Scan(&saved.Version, &saved.Data, &saved.UpdatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(ctx)
		current, loadErr := p.LoadState(ctx, id)
		if loadErr != nil && !errors.Is(loadErr, ErrNotFound) {
			return State{}, loadErr
		}
		return current, ErrConflict
	}
	if err != nil {
		return State{}, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO master_state_history (master_id, version, data, saved_at) VALUES ($1, $2, $3, $4)`,
		id, saved.Version, data, at); err != nil {
		return State{}, err
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM master_state_history WHERE master_id = $1 AND version <= $2`,
		id, saved.Version-p.historyKeep()); err != nil {
		return State{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return State{}, err
	}
	return saved, nil
}

func (p *Postgres) historyKeep() int {
	if p.HistoryKeep > 0 {
		return p.HistoryKeep
	}
	return DefaultHistoryKeep
}
func (p *Postgres) RecordUsage(ctx context.Context, id, kind string, at time.Time) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO usage_log (master_id, kind, created_at) VALUES ($1, $2, $3)`, id, kind, at)
	return err
}

func (p *Postgres) RecordEvent(ctx context.Context, id, kind string, payload json.RawMessage, at time.Time) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO master_events (master_id, kind, payload, created_at) VALUES ($1, $2, $3, $4)`,
		id, kind, payload, at)
	return err
}

func (p *Postgres) ListEvents(ctx context.Context, id string, limit int) ([]Event, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, kind, payload, created_at FROM master_events
		WHERE master_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, id, clampLimit(limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []Event{}
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.Kind, &event.Payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (p *Postgres) StateVersions(ctx context.Context, id string, limit int) ([]StateVersion, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT version, saved_at, octet_length(data::text) FROM master_state_history
		WHERE master_id = $1 ORDER BY version DESC LIMIT $2`, id, clampLimit(limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := []StateVersion{}
	for rows.Next() {
		var version StateVersion
		if err := rows.Scan(&version.Version, &version.SavedAt, &version.Size); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func (p *Postgres) StateSnapshot(ctx context.Context, id string, version int) (StateSnapshot, error) {
	var snapshot StateSnapshot
	err := p.pool.QueryRow(ctx,
		`SELECT version, saved_at, data FROM master_state_history WHERE master_id = $1 AND version = $2`,
		id, version).Scan(&snapshot.Version, &snapshot.SavedAt, &snapshot.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return StateSnapshot{}, ErrNotFound
	}
	return snapshot, err
}

func (p *Postgres) ExportMaster(ctx context.Context, id string) (Export, error) {
	var export Export
	var lastSeen *time.Time
	err := p.pool.QueryRow(ctx,
		`SELECT id, name, created_at, last_seen_at, disabled, city, timezone FROM masters WHERE id = $1`, id).
		Scan(&export.Master.ID, &export.Master.Name, &export.Master.CreatedAt, &lastSeen, &export.Master.Disabled, &export.Master.City, &export.Master.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return Export{}, ErrNotFound
	}
	if err != nil {
		return Export{}, err
	}
	if lastSeen != nil {
		export.Master.LastSeenAt = *lastSeen
	}
	export.ExportedAt = time.Now()

	if state, err := p.LoadState(ctx, id); err == nil {
		export.State = &state
	} else if !errors.Is(err, ErrNotFound) {
		return Export{}, err
	}

	history, err := p.pool.Query(ctx,
		`SELECT version, saved_at, data FROM master_state_history WHERE master_id = $1 ORDER BY version`, id)
	if err != nil {
		return Export{}, err
	}
	defer history.Close()
	export.History = []StateSnapshot{}
	for history.Next() {
		var snapshot StateSnapshot
		if err := history.Scan(&snapshot.Version, &snapshot.SavedAt, &snapshot.Data); err != nil {
			return Export{}, err
		}
		export.History = append(export.History, snapshot)
	}
	if err := history.Err(); err != nil {
		return Export{}, err
	}

	events, err := p.ListEvents(ctx, id, maxExportEvents)
	if err != nil {
		return Export{}, err
	}
	slices.Reverse(events)
	export.Events = events
	return export, nil
}

func (p *Postgres) DeleteMaster(ctx context.Context, id string) error {
	tag, err := p.pool.Exec(ctx, `DELETE FROM masters WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) Purge(ctx context.Context, before time.Time) (int64, error) {
	var removed int64
	for _, statement := range []string{
		`DELETE FROM master_events WHERE created_at < $1`,
		`DELETE FROM usage_log WHERE created_at < $1`,
		`DELETE FROM master_state_history h WHERE h.saved_at < $1
			AND h.version < (SELECT MAX(version) FROM master_state_history WHERE master_id = h.master_id)`,
	} {
		tag, err := p.pool.Exec(ctx, statement, before)
		if err != nil {
			return removed, err
		}
		removed += tag.RowsAffected()
	}
	return removed, nil
}

const (
	maxListLimit    = 500
	maxExportEvents = 100000
)

func clampLimit(limit int) int {
	if limit <= 0 || limit > maxExportEvents {
		return maxListLimit
	}
	return limit
}

const auditJobColumns = `j.id, j.master_id, COALESCE(m.name, ''), j.handle, j.status, j.attempts, j.created_at, j.claimed_at, j.finished_at, j.error, j.result`

func scanAuditJob(row pgx.Row) (AuditJob, error) {
	var job AuditJob
	var claimed, finished *time.Time
	if err := row.Scan(&job.ID, &job.MasterID, &job.MasterName, &job.Handle, &job.Status, &job.Attempts, &job.CreatedAt, &claimed, &finished, &job.Error, &job.Result); err != nil {
		return AuditJob{}, err
	}
	if claimed != nil {
		job.ClaimedAt = *claimed
	}
	if finished != nil {
		job.FinishedAt = *finished
	}
	return job, nil
}

func (p *Postgres) CreateAuditJob(ctx context.Context, masterID, handle string, at time.Time) (AuditJob, error) {
	id, err := newID()
	if err != nil {
		return AuditJob{}, err
	}
	var exists bool
	if err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM masters WHERE id = $1)`, masterID).Scan(&exists); err != nil {
		return AuditJob{}, err
	}
	if !exists {
		return AuditJob{}, ErrNotFound
	}
	_, err = p.pool.Exec(ctx,
		`INSERT INTO audit_jobs (id, master_id, handle, status, created_at) VALUES ($1, $2, $3, $4, $5)`,
		id, masterID, handle, JobQueued, at)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			active, loadErr := p.LatestAuditJob(ctx, masterID)
			if loadErr != nil {
				return AuditJob{}, loadErr
			}
			return active, ErrJobActive
		}
		return AuditJob{}, err
	}
	return p.AuditJob(ctx, id)
}

func (p *Postgres) LatestAuditJob(ctx context.Context, masterID string) (AuditJob, error) {
	job, err := scanAuditJob(p.pool.QueryRow(ctx,
		`SELECT `+auditJobColumns+` FROM audit_jobs j LEFT JOIN masters m ON m.id = j.master_id
		 WHERE j.master_id = $1 ORDER BY j.created_at DESC LIMIT 1`, masterID))
	if errors.Is(err, pgx.ErrNoRows) {
		return AuditJob{}, ErrNotFound
	}
	return job, err
}

func (p *Postgres) AuditJob(ctx context.Context, id string) (AuditJob, error) {
	job, err := scanAuditJob(p.pool.QueryRow(ctx,
		`SELECT `+auditJobColumns+` FROM audit_jobs j LEFT JOIN masters m ON m.id = j.master_id WHERE j.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return AuditJob{}, ErrNotFound
	}
	return job, err
}

func (p *Postgres) ClaimAuditJob(ctx context.Context, now time.Time, lease time.Duration) (AuditJob, error) {
	if _, err := p.pool.Exec(ctx, `
		UPDATE audit_jobs SET status = $1, finished_at = $2, error = 'агент не вернул результат'
		WHERE status = $3 AND claimed_at < $4 AND attempts >= $5`,
		JobFailed, now, JobRunning, now.Add(-lease), MaxJobAttempts); err != nil {
		return AuditJob{}, err
	}
	var id string
	err := p.pool.QueryRow(ctx, `
		UPDATE audit_jobs SET status = $1, claimed_at = $2, attempts = attempts + 1
		WHERE id = (
			SELECT id FROM audit_jobs
			WHERE status = $3 OR (status = $1 AND claimed_at < $4)
			ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id`, JobRunning, now, JobQueued, now.Add(-lease)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return AuditJob{}, ErrNotFound
	}
	if err != nil {
		return AuditJob{}, err
	}
	return p.AuditJob(ctx, id)
}

func (p *Postgres) jobTransition(ctx context.Context, id string, tag pgconn.CommandTag, err error) error {
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if _, loadErr := p.AuditJob(ctx, id); loadErr != nil {
		return loadErr
	}
	return ErrJobState
}

func (p *Postgres) CompleteAuditJob(ctx context.Context, id string, result json.RawMessage, at time.Time) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE audit_jobs SET status = $2, finished_at = $3, error = '', result = $4 WHERE id = $1 AND status = $5`,
		id, JobDone, at, result, JobRunning)
	return p.jobTransition(ctx, id, tag, err)
}

func (p *Postgres) FailAuditJob(ctx context.Context, id, reason string, final bool, at time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE audit_jobs SET error = $2,
			status = CASE WHEN $3 OR attempts >= $4 THEN $5 ELSE $6 END,
			finished_at = CASE WHEN $3 OR attempts >= $4 THEN $7::timestamptz ELSE NULL END
		WHERE id = $1 AND status = $8`,
		id, reason, final, MaxJobAttempts, JobFailed, JobQueued, at, JobRunning)
	return p.jobTransition(ctx, id, tag, err)
}

func (p *Postgres) CancelAuditJob(ctx context.Context, masterID, id string, at time.Time) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE audit_jobs SET status = $3, finished_at = $4 WHERE id = $1 AND master_id = $2 AND status IN ($5, $6)`,
		id, masterID, JobCanceled, at, JobQueued, JobRunning)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	job, loadErr := p.AuditJob(ctx, id)
	if loadErr != nil {
		return loadErr
	}
	if job.MasterID != masterID {
		return ErrNotFound
	}
	return ErrJobState
}

func (p *Postgres) ListAuditJobs(ctx context.Context, limit int) ([]AuditJob, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT `+auditJobColumns+` FROM audit_jobs j LEFT JOIN masters m ON m.id = j.master_id
		 ORDER BY j.created_at DESC LIMIT $1`, clampLimit(limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []AuditJob{}
	for rows.Next() {
		job, err := scanAuditJob(rows)
		if err != nil {
			return nil, err
		}
		job.Result = nil
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}
