package reminders

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

func (p *Postgres) Has(ctx context.Context, masterID, key string) (bool, error) {
	var exists bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM reminders_sent WHERE master_id = $1 AND key = $2)`, masterID, key).Scan(&exists)
	return exists, err
}

func (p *Postgres) Mark(ctx context.Context, masterID, key string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO reminders_sent (master_id, key, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, masterID, key, at)
	return err
}

func (p *Postgres) Forget(ctx context.Context, before time.Time) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM reminders_sent WHERE sent_at < $1`, before)
	return err
}
