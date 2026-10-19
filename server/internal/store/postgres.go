package store

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Postgres struct {
	pool   *pgxpool.Pool
	queue  chan func(context.Context) error
	wg     sync.WaitGroup
	logger *slog.Logger
	once   sync.Once
}

func Open(ctx context.Context, databaseURL string, logger *slog.Logger) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	if err := migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	p := &Postgres{
		pool:   pool,
		queue:  make(chan func(context.Context) error, queueSize),
		logger: logger,
	}
	p.wg.Add(1)
	go p.work()
	return p, nil
}

func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	const lockKey = 7283451
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockKey); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", lockKey) }()

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)", name).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}
		sqlText, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(sqlText)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (name) VALUES ($1)", name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

func (p *Postgres) work() {
	defer p.wg.Done()
	for job := range p.queue {
		ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
		if err := job(ctx); err != nil {
			p.logger.Warn("database write failed", slog.Any("error", err))
		}
		cancel()
	}
}

func (p *Postgres) enqueue(job func(context.Context) error) {
	select {
	case p.queue <- job:
	default:
		p.logger.Warn("database queue is full, record dropped")
	}
}

func (p *Postgres) Close() {
	p.once.Do(func() {
		close(p.queue)
		done := make(chan struct{})
		go func() {
			p.wg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-timeAfter(closeTimeout):
		}
		p.pool.Close()
	})
}

func (p *Postgres) SaveMessages(messages []Message) {
	if len(messages) == 0 {
		return
	}
	p.enqueue(func(ctx context.Context) error {
		batch := &pgx.Batch{}
		for _, m := range messages {
			attachments, err := json.Marshal(nonNilStrings(m.Attachments))
			if err != nil {
				return err
			}
			batch.Queue(`INSERT INTO messages (source, conversation_id, external_id, role, text, attachments, meta, created_at)
				VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, COALESCE($8, now()))
				ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
				m.Source, m.ConversationID, m.ExternalID, m.Role, clip(m.Text, MaxStoredTextBytes),
				attachments, rawOrEmpty(m.Meta), nullTime(m),
			)
		}
		results := p.pool.SendBatch(ctx, batch)
		defer results.Close()
		for range messages {
			if _, err := results.Exec(); err != nil {
				return fmt.Errorf("insert message: %w", err)
			}
		}
		return nil
	})
}

func (p *Postgres) SaveEvent(kind, ref string, payload any) {
	data := marshalOrEmpty(payload)
	p.enqueue(func(ctx context.Context) error {
		_, err := p.pool.Exec(ctx, "INSERT INTO events (kind, ref, payload) VALUES ($1, $2, $3)", kind, ref, data)
		return err
	})
}

func (p *Postgres) SaveError(source, message string, details any) {
	data := marshalOrEmpty(details)
	p.enqueue(func(ctx context.Context) error {
		_, err := p.pool.Exec(ctx, "INSERT INTO error_log (source, message, details) VALUES ($1, $2, $3)",
			source, clip(message, MaxStoredTextBytes), data)
		return err
	})
}

func (p *Postgres) Messages(ctx context.Context, filter MessageFilter) ([]Message, error) {
	ctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()

	rows, err := p.pool.Query(ctx, `SELECT id, source, conversation_id, COALESCE(external_id, ''), role, text, attachments, meta, created_at
		FROM (
			SELECT * FROM messages
			WHERE ($1 = '' OR source = $1) AND ($2 = '' OR conversation_id = $2)
			ORDER BY created_at DESC, id DESC
			LIMIT $3
		) recent
		ORDER BY created_at, id`, filter.Source, filter.ConversationID, clampLimit(filter.Limit))
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	messages := []Message{}
	for rows.Next() {
		var m Message
		var attachments []byte
		if err := rows.Scan(&m.ID, &m.Source, &m.ConversationID, &m.ExternalID, &m.Role, &m.Text, &attachments, &m.Meta, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		if err := json.Unmarshal(attachments, &m.Attachments); err != nil {
			return nil, fmt.Errorf("decode attachments: %w", err)
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

func (p *Postgres) Events(ctx context.Context, kind string, limit int) ([]Event, error) {
	ctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()

	rows, err := p.pool.Query(ctx, `SELECT id, kind, ref, payload, created_at FROM events
		WHERE ($1 = '' OR kind = $1) ORDER BY created_at DESC, id DESC LIMIT $2`, kind, clampLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Kind, &e.Ref, &e.Payload, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func (p *Postgres) Errors(ctx context.Context, limit int) ([]ErrorEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()

	rows, err := p.pool.Query(ctx, `SELECT id, source, message, details, created_at FROM error_log
		ORDER BY created_at DESC, id DESC LIMIT $1`, clampLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("query errors: %w", err)
	}
	defer rows.Close()

	entries := []ErrorEntry{}
	for rows.Next() {
		var e ErrorEntry
		if err := rows.Scan(&e.ID, &e.Source, &e.Message, &e.Details, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan error entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func clampLimit(limit int) int {
	switch {
	case limit <= 0:
		return DefaultListLimit
	case limit > MaxListLimit:
		return MaxListLimit
	default:
		return limit
	}
}

func clip(text string, maxBytes int) string {
	if len(text) <= maxBytes {
		return strings.ToValidUTF8(text, "")
	}
	return strings.ToValidUTF8(text[:maxBytes], "")
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func rawOrEmpty(raw json.RawMessage) []byte {
	if len(raw) == 0 || !json.Valid(raw) {
		return []byte("{}")
	}
	return raw
}

func marshalOrEmpty(value any) []byte {
	if value == nil {
		return []byte("{}")
	}
	data, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return data
}

func (p *Postgres) Pool() *pgxpool.Pool {
	return p.pool
}
