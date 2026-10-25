package digest

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

func (p *Postgres) Has(ctx context.Context, key string) (bool, error) {
	var exists bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM digest_sent WHERE key = $1)`, key).Scan(&exists)
	return exists, err
}

func (p *Postgres) Mark(ctx context.Context, key string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO digest_sent (key, sent_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`, key, at)
	return err
}
