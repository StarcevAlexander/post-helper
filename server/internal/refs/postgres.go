package refs

import (
	"context"
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

func (p *Postgres) Sync(ctx context.Context, masterID string, items []OrderItem, now time.Time) (int, int, error) {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	keys := make([]string, 0, len(items))
	for _, item := range items {
		keys = append(keys, item.Key)
	}
	removed, err := transaction.Exec(ctx,
		`DELETE FROM ref_items WHERE master_id = $1 AND NOT (item_key = ANY($2))`, masterID, keys)
	if err != nil {
		return 0, 0, err
	}
	added := 0
	for _, item := range items {
		var changed bool
		err := transaction.QueryRow(ctx, `
			INSERT INTO ref_items (id, master_id, item_key, format, pillar, idea, status, created_at, planned_date)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::date)
			ON CONFLICT (master_id, item_key) DO UPDATE SET
				format = EXCLUDED.format, pillar = EXCLUDED.pillar, idea = EXCLUDED.idea,
				status = $7, attempts = 0, error = '', claimed_at = NULL, finished_at = NULL
			WHERE ref_items.format <> EXCLUDED.format OR ref_items.pillar <> EXCLUDED.pillar OR ref_items.idea <> EXCLUDED.idea
			RETURNING true`,
			newID(), masterID, item.Key, item.Format, item.Pillar, item.Idea, StatusQueued, now, item.Date).Scan(&changed)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err := transaction.Exec(ctx, `
				UPDATE ref_items SET planned_date = NULLIF($3, '')::date
				WHERE master_id = $1 AND item_key = $2 AND planned_date IS DISTINCT FROM NULLIF($3, '')::date`,
				masterID, item.Key, item.Date); err != nil {
				return 0, 0, err
			}
			continue
		}
		if err != nil {
			return 0, 0, err
		}
		added++
		if _, err := transaction.Exec(ctx,
			`DELETE FROM ref_files WHERE item_id = (SELECT id FROM ref_items WHERE master_id = $1 AND item_key = $2)`,
			masterID, item.Key); err != nil {
			return 0, 0, err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return added, int(removed.RowsAffected()), nil
}

func (p *Postgres) Statuses(ctx context.Context, masterID string, now time.Time) ([]Status, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, item_key, format, status, error, COALESCE(to_char(planned_date, 'YYYY-MM-DD'), ''),
			status = $3 AND planned_date IS NOT NULL AND planned_date + $4::int <= $2::date
		FROM ref_items WHERE master_id = $1 ORDER BY item_key`, masterID, now, StatusDone, staleDays())
	if err != nil {
		return nil, err
	}
	statuses := []Status{}
	ids := map[string]int{}
	for rows.Next() {
		var id, format string
		var status Status
		if err := rows.Scan(&id, &status.Key, &format, &status.Status, &status.Error, &status.Date, &status.Stale); err != nil {
			rows.Close()
			return nil, err
		}
		status.Kind = KindFor(format)
		status.Files = []FileMeta{}
		ids[id] = len(statuses)
		statuses = append(statuses, status)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	fileRows, err := p.pool.Query(ctx, `
		SELECT f.item_id, f.id, f.idx, f.kind, f.media_type, f.caption, octet_length(f.data)
		FROM ref_files f JOIN ref_items i ON i.id = f.item_id
		WHERE i.master_id = $1 ORDER BY f.item_id, f.idx`, masterID)
	if err != nil {
		return nil, err
	}
	defer fileRows.Close()
	for fileRows.Next() {
		var itemID string
		var meta FileMeta
		if err := fileRows.Scan(&itemID, &meta.ID, &meta.Index, &meta.Kind, &meta.MediaType, &meta.Caption, &meta.Size); err != nil {
			return nil, err
		}
		if position, ok := ids[itemID]; ok {
			statuses[position].Files = append(statuses[position].Files, meta)
		}
	}
	return statuses, fileRows.Err()
}

func (p *Postgres) File(ctx context.Context, masterID, fileID string) (File, error) {
	var file File
	err := p.pool.QueryRow(ctx, `
		SELECT f.id, f.idx, f.kind, f.media_type, f.caption, f.data
		FROM ref_files f JOIN ref_items i ON i.id = f.item_id
		WHERE f.id = $1 AND i.master_id = $2`, fileID, masterID).
		Scan(&file.ID, &file.Index, &file.Kind, &file.MediaType, &file.Caption, &file.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	return file, err
}

func (p *Postgres) Claim(ctx context.Context, now time.Time, lease time.Duration) (Item, error) {
	if _, err := p.pool.Exec(ctx, `
		UPDATE ref_items SET status = $1, finished_at = $2, error = 'агент не вернул результат'
		WHERE status = $3 AND claimed_at < $4 AND attempts >= $5`,
		StatusFailed, now, StatusRunning, now.Add(-lease), MaxAttempts); err != nil {
		return Item{}, err
	}
	var item Item
	var claimed, finished *time.Time
	err := p.pool.QueryRow(ctx, `
		UPDATE ref_items SET status = $1, claimed_at = $2, attempts = attempts + 1
		WHERE id = (
			SELECT id FROM ref_items
			WHERE (status = $3 OR (status = $1 AND claimed_at < $4))
				AND NOT EXISTS (
					SELECT 1 FROM ref_items s
					WHERE s.master_id = ref_items.master_id AND s.status = $5
						AND s.planned_date IS NOT NULL AND s.planned_date + $6::int <= $2::date)
			ORDER BY created_at, item_key LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id, master_id, item_key, format, pillar, idea, status, attempts, created_at, claimed_at, finished_at, error`,
		StatusRunning, now, StatusQueued, now.Add(-lease), StatusDone, staleDays()).
		Scan(&item.ID, &item.MasterID, &item.Key, &item.Format, &item.Pillar, &item.Idea, &item.Status,
			&item.Attempts, &item.CreatedAt, &claimed, &finished, &item.Error)
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if claimed != nil {
		item.ClaimedAt = *claimed
	}
	if finished != nil {
		item.FinishedAt = *finished
	}
	return item, err
}

func (p *Postgres) Complete(ctx context.Context, id string, files []File, now time.Time) error {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	tag, err := transaction.Exec(ctx,
		`UPDATE ref_items SET status = $2, finished_at = $3, error = '' WHERE id = $1 AND status = $4`,
		id, StatusDone, now, StatusRunning)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return p.missing(ctx, id)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM ref_files WHERE item_id = $1`, id); err != nil {
		return err
	}
	for _, file := range files {
		if _, err := transaction.Exec(ctx, `
			INSERT INTO ref_files (id, item_id, idx, kind, media_type, caption, data)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			newID(), id, file.Index, file.Kind, file.MediaType, file.Caption, file.Data); err != nil {
			return err
		}
	}
	return transaction.Commit(ctx)
}

func (p *Postgres) Fail(ctx context.Context, id, reason string, final bool, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE ref_items SET error = $2,
			status = CASE WHEN $3 OR attempts >= $4 THEN $5 ELSE $6 END,
			finished_at = CASE WHEN $3 OR attempts >= $4 THEN $7::timestamptz ELSE finished_at END
		WHERE id = $1 AND status = $8`,
		id, reason, final, MaxAttempts, StatusFailed, StatusQueued, now, StatusRunning)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return p.missing(ctx, id)
	}
	return nil
}

func (p *Postgres) missing(ctx context.Context, id string) error {
	var exists bool
	if err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ref_items WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return ErrState
}

func (p *Postgres) DeleteMaster(ctx context.Context, masterID string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM ref_items WHERE master_id = $1`, masterID)
	return err
}

func staleDays() int {
	return int(StaleAfter/(24*time.Hour)) + 1
}

func (p *Postgres) Confirm(ctx context.Context, masterID, key string) error {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var id, status string
	err = transaction.QueryRow(ctx,
		`SELECT id, status FROM ref_items WHERE master_id = $1 AND item_key = $2 FOR UPDATE`, masterID, key).Scan(&id, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status == StatusRunning {
		return ErrState
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM ref_files WHERE item_id = $1`, id); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `UPDATE ref_items SET status = $2, error = '' WHERE id = $1`, id, StatusMade); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}
