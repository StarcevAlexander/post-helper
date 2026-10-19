CREATE TABLE ref_items (
    id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    format TEXT NOT NULL,
    pillar TEXT NOT NULL DEFAULT '',
    idea TEXT NOT NULL DEFAULT '',
    planned_date DATE,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '',
    UNIQUE (master_id, item_key)
);

CREATE INDEX ref_items_status_created_idx ON ref_items (status, created_at);

CREATE TABLE ref_files (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES ref_items (id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    kind TEXT NOT NULL,
    media_type TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    data BYTEA NOT NULL,
    UNIQUE (item_id, idx)
);
