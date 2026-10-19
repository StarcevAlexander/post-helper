CREATE TABLE masters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    disabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE master_state (
    master_id TEXT PRIMARY KEY REFERENCES masters (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_log (
    id BIGSERIAL PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX usage_log_master_created_idx ON usage_log (master_id, created_at);
