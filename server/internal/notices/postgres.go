package notices

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

const selectColumns = `SELECT id, master_id, title, body, url, topic, delivered, sent_at FROM notifications`

func (p *Postgres) Add(ctx context.Context, entry Entry) error {
	topic, err := json.Marshal(entry.Topic)
	if err != nil {
		return err
	}
	_, err = p.pool.Exec(ctx, `INSERT INTO notifications (id, master_id, title, body, url, topic, delivered, sent_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		entry.ID, entry.MasterID, entry.Title, entry.Body, entry.URL, topic, entry.Delivered, entry.SentAt)
	return err
}

func (p *Postgres) List(ctx context.Context, masterID string, limit int) ([]Entry, error) {
	rows, err := p.pool.Query(ctx, selectColumns+` WHERE master_id = $1 ORDER BY sent_at DESC, id DESC LIMIT $2`, masterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []Entry{}
	for rows.Next() {
		entry, err := scan(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (p *Postgres) Get(ctx context.Context, masterID, id string) (Entry, error) {
	entry, err := scan(p.pool.QueryRow(ctx, selectColumns+` WHERE master_id = $1 AND id = $2`, masterID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	return entry, err
}

func (p *Postgres) Purge(ctx context.Context, before time.Time) (int64, error) {
	tag, err := p.pool.Exec(ctx, `DELETE FROM notifications WHERE sent_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func scan(row pgx.Row) (Entry, error) {
	var entry Entry
	var topic []byte
	if err := row.Scan(&entry.ID, &entry.MasterID, &entry.Title, &entry.Body, &entry.URL, &topic, &entry.Delivered, &entry.SentAt); err != nil {
		return Entry{}, err
	}
	if err := json.Unmarshal(topic, &entry.Topic); err != nil {
		return Entry{}, err
	}
	return entry, nil
}
