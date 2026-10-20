-- 0002 Hardening Schema v2 for SQLite

-- Add columns to branches
ALTER TABLE branches ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Add columns to memories
ALTER TABLE memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN source_type TEXT DEFAULT 'user_stated';
ALTER TABLE memories ADD COLUMN sensitivity TEXT DEFAULT 'none';
ALTER TABLE memories ADD COLUMN subject_key TEXT;
ALTER TABLE memories ADD COLUMN valid_from TEXT;
ALTER TABLE memories ADD COLUMN valid_to TEXT;
ALTER TABLE memories ADD COLUMN expires_at TEXT;
ALTER TABLE memories ADD COLUMN last_used_at TEXT;
ALTER TABLE memories ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN content_hash TEXT;
ALTER TABLE memories ADD COLUMN index_state TEXT NOT NULL DEFAULT 'pending';

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
CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_after);

-- FTS5 full text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content_id UNINDEXED
);

-- Triggers to synchronize memories_fts
CREATE TRIGGER IF NOT EXISTS trg_memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(content, content_id) VALUES (new.content, new.id);
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE content_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_au AFTER UPDATE ON memories BEGIN
  DELETE FROM memories_fts WHERE content_id = old.id;
  INSERT INTO memories_fts(content, content_id) VALUES (new.content, new.id);
END;
