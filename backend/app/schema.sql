PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces(
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  profile_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches(
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  fork_commit_id TEXT,
  head_commit_id TEXT,
  system_prompt TEXT DEFAULT '',
  persona TEXT DEFAULT '',
  model TEXT,
  thinking_level TEXT DEFAULT 'medium',
  top_k INTEGER DEFAULT 6,
  memory_mode TEXT DEFAULT 'review',
  color TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits(
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES commits(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  trace_json TEXT,
  status TEXT DEFAULT 'complete',
  provider_parts_json TEXT,
  thought_signature TEXT,
  usage_json TEXT,
  source_branch_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories(
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  origin_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  source_commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  kind TEXT DEFAULT 'fact',
  importance REAL DEFAULT 0.5,
  embedding BLOB,
  embedding_model TEXT,
  embedding_dim INTEGER,
  supersedes_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  derived_from_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_overrides(
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  excluded INTEGER,
  pinned INTEGER,
  content_override TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, memory_id)
);

CREATE TABLE IF NOT EXISTS memory_proposals(
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  kind TEXT,
  importance REAL,
  conflicts_with_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  resolution TEXT,
  accepted_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints(
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_parent ON commits(parent_id);
CREATE INDEX IF NOT EXISTS idx_commits_branch_created ON commits(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commits_space ON commits(space_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_commit ON memories(source_commit_id);
CREATE INDEX IF NOT EXISTS idx_memories_space_origin ON memories(space_id, origin_branch_id);
CREATE INDEX IF NOT EXISTS idx_memory_overrides_memory ON memory_overrides(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_proposals_branch_status ON memory_proposals(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_branches_space_parent ON branches(space_id, parent_branch_id);

PRAGMA user_version = 1;
