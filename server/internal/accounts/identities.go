package accounts

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const uniqueViolation = "23505"

type memoryIdentity struct {
	provider string
	subject  string
	masterID string
	email    string
}

type memoryToken struct {
	hash     string
	masterID string
}

func (m *Memory) FindByIdentity(_ context.Context, provider, subject string) (Master, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, identity := range m.identities {
		if identity.provider == provider && identity.subject == subject {
			if master, ok := m.masters[identity.masterID]; ok {
				return master.Master, nil
			}
		}
	}
	return Master{}, ErrNotFound
}

func (m *Memory) RegisterIdentity(_ context.Context, name, codeHash, provider, subject, email string) (Master, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.identityTaken(provider, subject, "") {
		return Master{}, ErrIdentityTaken
	}
	id, err := newID()
	if err != nil {
		return Master{}, err
	}
	master := Master{ID: id, Name: name, CreatedAt: time.Now()}
	m.masters[id] = &memoryMaster{Master: master, codeHash: codeHash}
	m.identities = append(m.identities, memoryIdentity{provider: provider, subject: subject, masterID: id, email: email})
	return master, nil
}

func (m *Memory) LinkIdentity(_ context.Context, masterID, provider, subject, email string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.masters[masterID]; !ok {
		return ErrNotFound
	}
	if m.identityTaken(provider, subject, masterID) {
		return ErrIdentityTaken
	}
	for _, identity := range m.identities {
		if identity.masterID == masterID && identity.provider == provider {
			if identity.subject == subject {
				return nil
			}
			return ErrIdentityTaken
		}
	}
	m.identities = append(m.identities, memoryIdentity{provider: provider, subject: subject, masterID: masterID, email: email})
	return nil
}

func (m *Memory) identityTaken(provider, subject, exceptMaster string) bool {
	for _, identity := range m.identities {
		if identity.provider == provider && identity.subject == subject && identity.masterID != exceptMaster {
			return true
		}
	}
	return false
}

func (m *Memory) Providers(_ context.Context, masterID string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	providers := []string{}
	for _, identity := range m.identities {
		if identity.masterID == masterID {
			providers = append(providers, identity.provider)
		}
	}
	return providers, nil
}

func (m *Memory) AddToken(_ context.Context, masterID, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.masters[masterID]; !ok {
		return ErrNotFound
	}
	m.tokens = append(m.tokens, memoryToken{hash: tokenHash, masterID: masterID})
	owned := 0
	for _, token := range m.tokens {
		if token.masterID == masterID {
			owned++
		}
	}
	for owned > MaxTokensPerMaster {
		index := slices.IndexFunc(m.tokens, func(token memoryToken) bool { return token.masterID == masterID })
		m.tokens = slices.Delete(m.tokens, index, index+1)
		owned--
	}
	return nil
}

func (p *Postgres) FindByIdentity(ctx context.Context, provider, subject string) (Master, error) {
	var master Master
	var lastSeen *time.Time
	err := p.pool.QueryRow(ctx, `
		SELECT m.id, m.name, m.created_at, m.last_seen_at, m.disabled
		FROM master_identities i JOIN masters m ON m.id = i.master_id
		WHERE i.provider = $1 AND i.subject = $2`,
		provider, subject).Scan(&master.ID, &master.Name, &master.CreatedAt, &lastSeen, &master.Disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return Master{}, ErrNotFound
	}
	if lastSeen != nil {
		master.LastSeenAt = *lastSeen
	}
	return master, err
}

func (p *Postgres) RegisterIdentity(ctx context.Context, name, codeHash, provider, subject, email string) (Master, error) {
	id, err := newID()
	if err != nil {
		return Master{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Master{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	master := Master{ID: id, Name: name}
	if err := tx.QueryRow(ctx,
		`INSERT INTO masters (id, name, code_hash) VALUES ($1, $2, $3) RETURNING created_at`,
		id, name, codeHash).Scan(&master.CreatedAt); err != nil {
		return Master{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO master_identities (provider, subject, master_id, email) VALUES ($1, $2, $3, $4)`,
		provider, subject, id, email); err != nil {
		if isUniqueViolation(err) {
			return Master{}, ErrIdentityTaken
		}
		return Master{}, err
	}
	return master, tx.Commit(ctx)
}

func (p *Postgres) LinkIdentity(ctx context.Context, masterID, provider, subject, email string) error {
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO master_identities (provider, subject, master_id, email)
		SELECT $1, $2, id, $4 FROM masters WHERE id = $3
		ON CONFLICT (provider, subject) DO NOTHING`,
		provider, subject, masterID, email)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrIdentityTaken
		}
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	var owner string
	err = p.pool.QueryRow(ctx,
		`SELECT master_id FROM master_identities WHERE provider = $1 AND subject = $2`,
		provider, subject).Scan(&owner)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNotFound
	case err != nil:
		return err
	case owner != masterID:
		return ErrIdentityTaken
	}
	return nil
}

func (p *Postgres) Providers(ctx context.Context, masterID string) ([]string, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT provider FROM master_identities WHERE master_id = $1 ORDER BY provider`, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []string{}
	for rows.Next() {
		var provider string
		if err := rows.Scan(&provider); err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, rows.Err()
}

func (p *Postgres) AddToken(ctx context.Context, masterID, tokenHash string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		INSERT INTO master_tokens (token_hash, master_id)
		SELECT $1, id FROM masters WHERE id = $2`, tokenHash, masterID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM master_tokens WHERE master_id = $1 AND token_hash NOT IN (
			SELECT token_hash FROM master_tokens WHERE master_id = $1
			ORDER BY created_at DESC, token_hash LIMIT $2)`,
		masterID, MaxTokensPerMaster); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}
