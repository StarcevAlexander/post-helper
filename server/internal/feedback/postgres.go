package feedback

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

func (p *Postgres) Add(ctx context.Context, message Message) (Message, error) {
	err := p.pool.QueryRow(ctx, `
		INSERT INTO feedback (id, master_id, master_name, email, contact, text, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at`,
		message.ID, message.MasterID, message.MasterName, message.Email, message.Contact, message.Text, message.CreatedAt,
	).Scan(&message.CreatedAt)
	return message, err
}

func (p *Postgres) CountSince(ctx context.Context, masterID string, since time.Time) (int, error) {
	var count int
	err := p.pool.QueryRow(ctx,
		`SELECT count(*) FROM feedback WHERE master_id = $1 AND created_at >= $2`, masterID, since).Scan(&count)
	return count, err
}

func (p *Postgres) List(ctx context.Context, limit int) ([]Message, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, COALESCE(master_id, ''), master_name, email, contact, text, created_at
		FROM feedback ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	listed := []Message{}
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.MasterID, &message.MasterName, &message.Email, &message.Contact, &message.Text, &message.CreatedAt); err != nil {
			return nil, err
		}
		listed = append(listed, message)
	}
	return listed, rows.Err()
}
