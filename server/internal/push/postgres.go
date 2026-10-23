package push

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

func (p *Postgres) Save(ctx context.Context, masterID string, subscription Subscription, now time.Time) error {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	if _, err := transaction.Exec(ctx, `
		INSERT INTO push_subscriptions (endpoint, master_id, p256dh, auth, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint) DO UPDATE SET
			master_id = EXCLUDED.master_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = EXCLUDED.created_at`,
		subscription.Endpoint, masterID, subscription.P256dh, subscription.Auth, now); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		DELETE FROM push_subscriptions WHERE master_id = $1 AND endpoint NOT IN (
			SELECT endpoint FROM push_subscriptions WHERE master_id = $1 ORDER BY created_at DESC LIMIT $2)`,
		masterID, MaxSubscriptionsPerMaster); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func (p *Postgres) Remove(ctx context.Context, masterID, endpoint string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE master_id = $1 AND endpoint = $2`, masterID, endpoint)
	return err
}

func (p *Postgres) RemoveEndpoint(ctx context.Context, endpoint string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}

func (p *Postgres) List(ctx context.Context, masterID string) ([]Subscription, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE master_id = $1 ORDER BY created_at DESC`, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var subscriptions []Subscription
	for rows.Next() {
		var subscription Subscription
		if err := rows.Scan(&subscription.Endpoint, &subscription.P256dh, &subscription.Auth); err != nil {
			return nil, err
		}
		subscriptions = append(subscriptions, subscription)
	}
	return subscriptions, rows.Err()
}
