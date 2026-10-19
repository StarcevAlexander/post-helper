CREATE TABLE master_state_history (
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (master_id, version)
);

CREATE TABLE master_events (
    id BIGSERIAL PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX master_events_master_created_idx ON master_events (master_id, created_at DESC);

CREATE INDEX master_events_created_idx ON master_events (created_at);

CREATE INDEX master_state_history_saved_idx ON master_state_history (saved_at);
