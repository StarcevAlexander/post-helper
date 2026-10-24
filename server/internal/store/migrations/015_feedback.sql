CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    master_id TEXT REFERENCES masters (id) ON DELETE SET NULL,
    master_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feedback_master_created_idx ON feedback (master_id, created_at DESC);
CREATE INDEX feedback_created_idx ON feedback (created_at DESC);
