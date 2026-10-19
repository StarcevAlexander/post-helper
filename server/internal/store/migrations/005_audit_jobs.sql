CREATE TABLE audit_jobs (
    id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES masters (id) ON DELETE CASCADE,
    handle TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '',
    result JSONB
);

CREATE INDEX audit_jobs_status_created_idx ON audit_jobs (status, created_at);

CREATE INDEX audit_jobs_master_created_idx ON audit_jobs (master_id, created_at DESC);

CREATE UNIQUE INDEX audit_jobs_one_active_per_master_idx ON audit_jobs (master_id)
    WHERE status IN ('queued', 'running');
