package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
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
		`SELECT id, name, created_at, last_seen_at, disabled FROM masters WHERE code_hash = $1`,
		codeHash).Scan(&master.ID, &master.Name, &master.CreatedAt, &lastSeen, &master.Disabled)
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
		SELECT m.id, m.name, m.created_at, m.last_seen_at, m.disabled,
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
		if err := rows.Scan(&summary.ID, &summary.Name, &summary.CreatedAt, &lastSeen, &summary.Disabled, &summary.UsageToday, &summary.UsageTotal); err != nil {
			return nil, err
		}
		if lastSeen != nil {
			summary.LastSeenAt = *lastSeen
		}
		summaries = append(summaries, summary)
	}
	return summaries, rows.Err()
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
	var saved State
	var err error
	if baseVersion == 0 {
		err = p.pool.QueryRow(ctx, `
			INSERT INTO master_state (master_id, version, data, updated_at) VALUES ($1, 1, $2, $3)
			ON CONFLICT (master_id) DO NOTHING
			RETURNING version, data, updated_at`, id, data, at).Scan(&saved.Version, &saved.Data, &saved.UpdatedAt)
	} else {
		err = p.pool.QueryRow(ctx, `
			UPDATE master_state SET version = version + 1, data = $3, updated_at = $4
			WHERE master_id = $1 AND version = $2
			RETURNING version, data, updated_at`, id, baseVersion, data, at).Scan(&saved.Version, &saved.Data, &saved.UpdatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		current, loadErr := p.LoadState(ctx, id)
		if loadErr != nil && !errors.Is(loadErr, ErrNotFound) {
			return State{}, loadErr
		}
		return current, ErrConflict
	}
	return saved, err
}

func (p *Postgres) CountUsage(ctx context.Context, id string, since time.Time) (int, error) {
	var count int
	err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM usage_log WHERE master_id = $1 AND created_at >= $2`, id, since).Scan(&count)
	return count, err
}

func (p *Postgres) RecordUsage(ctx context.Context, id, kind string, at time.Time) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO usage_log (master_id, kind, created_at) VALUES ($1, $2, $3)`, id, kind, at)
	return err
}
