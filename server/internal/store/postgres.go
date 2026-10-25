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
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Postgres struct {
	pool   *pgxpool.Pool
	queue  chan func(context.Context) error
	wg     sync.WaitGroup
	logger *slog.Logger
	mu     sync.Mutex
	closed bool
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
	return newPostgres(pool, logger), nil
}

func newPostgres(pool *pgxpool.Pool, logger *slog.Logger) *Postgres {
	p := &Postgres{
		pool:   pool,
		queue:  make(chan func(context.Context) error, queueSize),
		logger: logger,
	}
	p.wg.Add(1)
	go p.work()
	return p
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
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	select {
	case p.queue <- job:
	default:
		p.logger.Warn("database queue is full, record dropped")
	}
}

func (p *Postgres) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	close(p.queue)
	p.mu.Unlock()

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
}

func (p *Postgres) SaveError(source, message string, details any) {
	data := marshalOrEmpty(details)
	p.enqueue(func(ctx context.Context) error {
		_, err := p.pool.Exec(ctx, "INSERT INTO error_log (source, message, details) VALUES ($1, $2, $3)",
			source, clip(message, MaxStoredTextBytes), data)
		return err
	})
}

func (p *Postgres) Purge(ctx context.Context, before time.Time) (int64, error) {
	var removed int64
	for _, statement := range purgeStatements {
		tag, err := p.pool.Exec(ctx, statement, before)
		if err != nil {
			return removed, fmt.Errorf("purge logs: %w", err)
		}
		removed += tag.RowsAffected()
	}
	return removed, nil
}

func clip(text string, maxBytes int) string {
	if len(text) <= maxBytes {
		return strings.ToValidUTF8(text, "")
	}
	return strings.ToValidUTF8(text[:maxBytes], "")
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
