CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    topic JSONB NOT NULL DEFAULT '{}',
    delivered INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX notifications_master_sent_idx ON notifications (master_id, sent_at DESC);
CREATE INDEX notifications_sent_idx ON notifications (sent_at);
