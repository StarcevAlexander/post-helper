CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    conversation_id TEXT NOT NULL DEFAULT '',
    external_id TEXT,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]',
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX messages_external_uq ON messages (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX messages_conversation_idx ON messages (source, conversation_id, created_at);

CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_kind_idx ON events (kind, created_at DESC);
CREATE INDEX events_ref_idx ON events (ref) WHERE ref <> '';

CREATE TABLE error_log (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX error_log_created_idx ON error_log (created_at DESC);
