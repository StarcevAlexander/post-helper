CREATE TABLE master_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (master_id, provider)
);

CREATE TABLE master_tokens (
    token_hash TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX master_tokens_master_created_idx ON master_tokens (master_id, created_at DESC);
