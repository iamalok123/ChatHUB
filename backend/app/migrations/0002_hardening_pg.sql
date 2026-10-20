-- 0002 Hardening Schema v2 for PostgreSQL / NeonDB

-- Add columns to branches
ALTER TABLE branches ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Add columns to memories
ALTER TABLE memories ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'user_stated';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS sensitivity TEXT DEFAULT 'none';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS subject_key TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS index_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Audit and version history tables
CREATE TABLE IF NOT EXISTS memory_events(
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_versions(
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  kind TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_summaries(
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  start_commit_id TEXT,
  end_commit_id TEXT,
  summary TEXT NOT NULL,
  hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events(
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys(
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(space_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_subject_key ON memories(space_id, subject_key);
CREATE INDEX IF NOT EXISTS idx_memories_tsv ON memories USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_after);
