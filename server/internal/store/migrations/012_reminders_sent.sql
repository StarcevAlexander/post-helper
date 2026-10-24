CREATE TABLE reminders_sent (
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (master_id, key)
);

CREATE INDEX reminders_sent_at_idx ON reminders_sent (sent_at);
