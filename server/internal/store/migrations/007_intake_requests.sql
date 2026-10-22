CREATE TABLE intake_requests (
    id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    networks JSONB NOT NULL,
    goals JSONB NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    reply_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    ready_at TIMESTAMPTZ
);

CREATE INDEX intake_requests_master_idx ON intake_requests (master_id, created_at DESC);
CREATE INDEX intake_requests_status_idx ON intake_requests (status, created_at DESC);
