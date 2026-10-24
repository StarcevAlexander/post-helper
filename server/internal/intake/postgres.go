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

const selectColumns = `id, master_id, networks, inspirations, goals, note, status, reply_note, created_at, updated_at, ready_at, review`

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
			UPDATE intake_requests SET networks = $2, goals = $3, note = $4, updated_at = $5, inspirations = $6, review = $7 WHERE id = $1`,
			id, networks, goals, draft.Note, now, references, draft.Review)
	case errors.Is(err, pgx.ErrNoRows):
		id = newID()
		_, err = transaction.Exec(ctx, `
			INSERT INTO intake_requests (id, master_id, networks, goals, note, status, created_at, updated_at, inspirations, review)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
			id, masterID, networks, goals, draft.Note, StatusNew, now, references, draft.Review)
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
		WHERE id = (SELECT id FROM intake_requests WHERE master_id = $1 ORDER BY created_at DESC LIMIT 1)`,
		masterID, StatusReady, replyNote, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scan(row pgx.Row) (Request, error) {
	var request Request
	var networks, references, goals []byte
	var ready *time.Time
	err := row.Scan(&request.ID, &request.MasterID, &networks, &references, &goals, &request.Note, &request.Status,
		&request.ReplyNote, &request.CreatedAt, &request.UpdatedAt, &ready, &request.Review)
	if err != nil {
		return Request{}, err
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
	if ready != nil {
		request.ReadyAt = *ready
	}
	return request, nil
}
