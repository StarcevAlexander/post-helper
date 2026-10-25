package intake

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

const selectColumns = `id, master_id, networks, inspirations, goals, note, status, reply_note, created_at, updated_at, ready_at, review, city, stats, schedule`

func (p *Postgres) Submit(ctx context.Context, masterID string, draft Draft, now time.Time) (Request, bool, error) {
	networks, err := json.Marshal(draft.Networks)
	if err != nil {
		return Request{}, false, err
	}
	references, err := json.Marshal(nonNil(draft.References))
	if err != nil {
		return Request{}, false, err
	}
	goals, err := json.Marshal(draft.Goals)
	if err != nil {
		return Request{}, false, err
	}
	stats, err := marshalOptional(draft.Stats)
	if err != nil {
		return Request{}, false, err
	}
	schedule, err := marshalOptional(draft.Schedule)
	if err != nil {
		return Request{}, false, err
	}
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return Request{}, false, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var id string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM intake_requests WHERE master_id = $1 AND status = $2
		ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, masterID, StatusNew).Scan(&id)
	updated := err == nil
	switch {
	case updated:
		_, err = transaction.Exec(ctx, `
			UPDATE intake_requests SET networks = $2, goals = $3, note = $4, updated_at = $5, inspirations = $6, review = $7, city = $8, stats = $9, schedule = $10 WHERE id = $1`,
			id, networks, goals, draft.Note, now, references, draft.Review, draft.City, stats, schedule)
	case errors.Is(err, pgx.ErrNoRows):
		id = newID()
		_, err = transaction.Exec(ctx, `
			INSERT INTO intake_requests (id, master_id, networks, goals, note, status, created_at, updated_at, inspirations, review, city, stats, schedule)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12)`,
			id, masterID, networks, goals, draft.Note, StatusNew, now, references, draft.Review, draft.City, stats, schedule)
	}
	if err != nil {
		return Request{}, false, err
	}
	request, err := scan(transaction.QueryRow(ctx, `SELECT `+selectColumns+` FROM intake_requests WHERE id = $1`, id))
	if err != nil {
		return Request{}, false, err
	}
	return request, updated, transaction.Commit(ctx)
}

func (p *Postgres) Latest(ctx context.Context, masterID string) (Request, error) {
	request, err := scan(p.pool.QueryRow(ctx, `
		SELECT `+selectColumns+` FROM intake_requests WHERE master_id = $1
		ORDER BY created_at DESC LIMIT 1`, masterID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	return request, err
}

func (p *Postgres) List(ctx context.Context, status string, limit int) ([]Request, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT `+selectColumns+` FROM intake_requests
		WHERE $1 = '' OR status = $1 ORDER BY created_at DESC LIMIT $2`, status, max(limit, 1))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	listed := []Request{}
	for rows.Next() {
		request, err := scan(rows)
		if err != nil {
			return nil, err
		}
		listed = append(listed, request)
	}
	return listed, rows.Err()
}

func (p *Postgres) Ready(ctx context.Context, masterID, replyNote string, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE intake_requests SET status = $2, reply_note = $3, updated_at = $4, ready_at = $4
		WHERE status = $5 AND id = (SELECT id FROM intake_requests WHERE master_id = $1 ORDER BY created_at DESC LIMIT 1)`,
		masterID, StatusReady, replyNote, now, StatusNew)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		_, err := p.Latest(ctx, masterID)
		return err
	}
	return nil
}

func marshalOptional[T any](value *T) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	return json.Marshal(value)
}

func scan(row pgx.Row) (Request, error) {
	var request Request
	var networks, references, goals, stats, schedule []byte
	var ready *time.Time
	err := row.Scan(&request.ID, &request.MasterID, &networks, &references, &goals, &request.Note, &request.Status,
		&request.ReplyNote, &request.CreatedAt, &request.UpdatedAt, &ready, &request.Review, &request.City, &stats, &schedule)
	if err != nil {
		return Request{}, err
	}
	if len(schedule) > 0 {
		var parsed Schedule
		if err := json.Unmarshal(schedule, &parsed); err != nil {
			return Request{}, err
		}
		request.Schedule = &parsed
	}
	if err := json.Unmarshal(networks, &request.Networks); err != nil {
		return Request{}, err
	}
	if err := json.Unmarshal(references, &request.References); err != nil {
		return Request{}, err
	}
	if err := json.Unmarshal(goals, &request.Goals); err != nil {
		return Request{}, err
	}
	if len(stats) > 0 {
		var parsed Stats
		if err := json.Unmarshal(stats, &parsed); err != nil {
			return Request{}, err
		}
		request.Stats = &parsed
	}
	if ready != nil {
		request.ReadyAt = *ready
	}
	return request, nil
}
