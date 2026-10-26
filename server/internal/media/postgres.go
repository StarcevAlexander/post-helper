package media

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const itemColumns = `id, master_id, item_key, unit, kind, format, pillar, idea, overlay, note, caption, status, attempts, error,
	created_at, claimed_at, finished_at, source_name, source_type, source_size, source_ref,
	result_type, result_size, result_width, result_height, result_duration_ms, result_subtitled, result_note,
	result_ref, thumb_ref`

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

type scanner interface {
	Scan(dest ...any) error
}

func scanItem(row scanner) (Item, error) {
	var item Item
	var claimed, finished *time.Time
	err := row.Scan(&item.ID, &item.MasterID, &item.Key, &item.Unit, &item.Kind, &item.Format, &item.Pillar,
		&item.Idea, &item.Overlay, &item.Note, &item.Caption, &item.Status, &item.Attempts, &item.Error, &item.CreatedAt, &claimed, &finished,
		&item.Source.Name, &item.Source.Type, &item.Source.Size, &item.SourceRef,
		&item.Result.Type, &item.Result.Size, &item.Result.Width, &item.Result.Height, &item.Result.DurationMs,
		&item.Result.Subtitled, &item.Result.Note, &item.ResultRef, &item.ThumbRef)
	if err != nil {
		return Item{}, err
	}
	if claimed != nil {
		item.ClaimedAt = *claimed
	}
	if finished != nil {
		item.FinishedAt = *finished
	}
	item.Result.Thumb = item.ThumbRef != "" || strings.HasPrefix(item.Result.Type, "image/")
	return item, nil
}

func (p *Postgres) collect(rows pgx.Rows) ([]Item, error) {
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (p *Postgres) Create(ctx context.Context, item Item, limit int) error {
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO media_items (id, master_id, item_key, unit, kind, format, pillar, idea, overlay, status, created_at,
			source_name, source_type, source_size, source_ref, note)
		SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text,
			$11::timestamptz, $12::text, $13::text, $14::bigint, $15::text, $17::text
		WHERE $16::int <= 0 OR (SELECT COUNT(*) FROM media_items WHERE master_id = $2) < $16::int`,
		item.ID, item.MasterID, item.Key, item.Unit, item.Kind, item.Format, item.Pillar, item.Idea, item.Overlay,
		item.Status, item.CreatedAt, item.Source.Name, item.Source.Type, item.Source.Size, item.SourceRef, limit, item.Note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTooMany
	}
	return nil
}

func (p *Postgres) List(ctx context.Context, masterID string) ([]Item, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT `+itemColumns+` FROM media_items WHERE master_id = $1 ORDER BY created_at, id`, masterID)
	if err != nil {
		return nil, err
	}
	return p.collect(rows)
}

func (p *Postgres) Get(ctx context.Context, masterID, id string) (Item, error) {
	item, err := scanItem(p.pool.QueryRow(ctx,
		`SELECT `+itemColumns+` FROM media_items WHERE id = $1 AND master_id = $2`, id, masterID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func (p *Postgres) Find(ctx context.Context, id string) (Item, error) {
	item, err := scanItem(p.pool.QueryRow(ctx, `SELECT `+itemColumns+` FROM media_items WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func (p *Postgres) SetCaption(ctx context.Context, id, caption string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE media_items SET caption = $2 WHERE id = $1`, id, caption)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) Remove(ctx context.Context, masterID, id string) (Item, error) {
	item, err := scanItem(p.pool.QueryRow(ctx,
		`DELETE FROM media_items WHERE id = $1 AND master_id = $2 RETURNING `+itemColumns, id, masterID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func (p *Postgres) Recent(ctx context.Context, limit int) ([]Item, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT `+itemColumns+` FROM media_items ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return p.collect(rows)
}

func (p *Postgres) Expire(ctx context.Context, now time.Time, lease time.Duration) ([]string, error) {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	rows, err := transaction.Query(ctx, `
		SELECT id, source_ref FROM media_items
		WHERE status = $1 AND claimed_at < $2 AND attempts >= $3 FOR UPDATE`,
		StatusRunning, now.Add(-lease), MaxAttempts)
	if err != nil {
		return nil, err
	}
	var ids, refs []string
	for rows.Next() {
		var id, ref string
		if err := rows.Scan(&id, &ref); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
		refs = appendRef(refs, ref)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE media_items SET status = $2, finished_at = $3, error = $4, source_ref = ''
		WHERE id = ANY($1)`, ids, StatusFailed, now, DefaultFailReason); err != nil {
		return nil, err
	}
	return refs, transaction.Commit(ctx)
}

func (p *Postgres) Claim(ctx context.Context, now time.Time, lease time.Duration) (Item, error) {
	item, err := scanItem(p.pool.QueryRow(ctx, `
		UPDATE media_items SET status = $1, claimed_at = $2, attempts = attempts + 1
		WHERE id = (
			SELECT id FROM media_items
			WHERE status = $3 OR (status = $1 AND claimed_at < $4)
			ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING `+itemColumns,
		StatusRunning, now, StatusQueued, now.Add(-lease)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func (p *Postgres) Complete(ctx context.Context, id string, result Result, resultRef, thumbRef string, now time.Time) (string, error) {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var status, sourceRef string
	err = transaction.QueryRow(ctx, `SELECT status, source_ref FROM media_items WHERE id = $1 FOR UPDATE`, id).Scan(&status, &sourceRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if status != StatusRunning {
		return "", ErrState
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE media_items SET status = $2, finished_at = $3, error = '', source_ref = '',
			result_type = $4, result_size = $5, result_width = $6, result_height = $7, result_duration_ms = $8,
			result_subtitled = $9, result_note = $10, result_ref = $11, thumb_ref = $12
		WHERE id = $1`,
		id, StatusDone, now, result.Type, result.Size, result.Width, result.Height, result.DurationMs,
		result.Subtitled, result.Note, resultRef, thumbRef); err != nil {
		return "", err
	}
	return sourceRef, transaction.Commit(ctx)
}

func (p *Postgres) Fail(ctx context.Context, id, reason string, final bool, now time.Time) (string, error) {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var status, sourceRef string
	var attempts int
	err = transaction.QueryRow(ctx, `SELECT status, source_ref, attempts FROM media_items WHERE id = $1 FOR UPDATE`, id).
		Scan(&status, &sourceRef, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if status != StatusRunning {
		return "", ErrState
	}
	if final || attempts >= MaxAttempts {
		if _, err := transaction.Exec(ctx, `
			UPDATE media_items SET status = $2, finished_at = $3, error = $4, source_ref = '' WHERE id = $1`,
			id, StatusFailed, now, reason); err != nil {
			return "", err
		}
		return sourceRef, transaction.Commit(ctx)
	}
	if _, err := transaction.Exec(ctx, `UPDATE media_items SET status = $2 WHERE id = $1`, id, StatusQueued); err != nil {
		return "", err
	}
	return "", transaction.Commit(ctx)
}

func (p *Postgres) Remaining(ctx context.Context, masterID string) (int, int, error) {
	var active, done int
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status IN ($2, $3)), COUNT(*) FILTER (WHERE status = $4)
		FROM media_items WHERE master_id = $1`,
		masterID, StatusQueued, StatusRunning, StatusDone).Scan(&active, &done)
	return active, done, err
}

func (p *Postgres) MasterOf(ctx context.Context, id string) (string, error) {
	var masterID string
	err := p.pool.QueryRow(ctx, `SELECT master_id FROM media_items WHERE id = $1`, id).Scan(&masterID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return masterID, err
}

func (p *Postgres) Purge(ctx context.Context, before time.Time) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		DELETE FROM media_items
		WHERE status IN ($1, $2) AND COALESCE(finished_at, created_at) < $3
		RETURNING source_ref, result_ref, thumb_ref`, StatusDone, StatusFailed, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var refs []string
	for rows.Next() {
		var source, result, thumb string
		if err := rows.Scan(&source, &result, &thumb); err != nil {
			return nil, err
		}
		refs = appendRef(appendRef(appendRef(refs, source), result), thumb)
	}
	return refs, rows.Err()
}
