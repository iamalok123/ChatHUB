from __future__ import annotations

import sqlite3
from pathlib import Path

from app.db import Database
from app.migrations import get_applied_migrations


def test_schema_migration_runner(tmp_path: Path):
    """SCH-001: Migration runner must apply 0001 and 0002 and track applied IDs."""
    db_file = tmp_path / "test_migrated.db"
    db = Database(db_file)
    db.initialize()

    conn = db.connect()
    try:
        applied = get_applied_migrations(conn)
        assert "0001" in applied
        assert "0002" in applied

        # Verify new tables exist
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        expected_tables = {
            "users",
            "sessions",
            "spaces",
            "branches",
            "commits",
            "memories",
            "memory_overrides",
            "memory_proposals",
            "checkpoints",
            "schema_migrations",
            "memory_events",
            "memory_versions",
            "branch_summaries",
            "outbox_events",
            "jobs",
            "idempotency_keys",
            "memories_fts",
        }
        for table in expected_tables:
            assert table in tables, f"Expected table '{table}' to exist"

        # Verify new columns on memories
        columns = {row[1] for row in conn.execute("PRAGMA table_info(memories)").fetchall()}
        expected_columns = {
            "version",
            "status",
            "confidence",
            "source_type",
            "sensitivity",
            "subject_key",
            "valid_from",
            "valid_to",
            "expires_at",
            "last_used_at",
            "use_count",
            "locked",
            "content_hash",
            "index_state",
        }
        for col in expected_columns:
            assert col in columns, f"Expected column '{col}' on memories"

        # Verify FTS5 sync trigger works
        conn.execute(
            """
            INSERT INTO users (id, email, password_hash, display_name, created_at)
            VALUES ('u1', 'u@test.com', 'hash', 'U', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO spaces (id, owner_id, name, created_at)
            VALUES ('s1', 'u1', 'Space 1', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO branches (id, space_id, name, created_at)
            VALUES ('b1', 's1', 'main', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO commits (id, space_id, branch_id, role, content, created_at)
            VALUES ('c1', 's1', 'b1', 'anchor', '', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO memories (
                id, space_id, origin_branch_id, source_commit_id, content, created_at
            )
            VALUES ('m1', 's1', 'b1', 'c1', 'UniqueFtsTokenForTesting', '2026-10-20T00:00:00Z')
            """
        )
        conn.commit()

        # Query FTS table
        fts_match = conn.execute(
            "SELECT content_id FROM memories_fts "
            "WHERE memories_fts MATCH 'UniqueFtsTokenForTesting'"
        ).fetchone()
        assert fts_match is not None
        assert fts_match[0] == "m1"
    finally:
        conn.close()


def test_upgrade_v1_db_to_v2_preserves_data(tmp_path: Path):
    """Verify that an existing v1 database gets migrated to v2 without data loss."""
    db_file = tmp_path / "v1_legacy.db"
    conn = sqlite3.connect(db_file)
    v1_path = Path(__file__).parent.parent / "app" / "migrations" / "0001_initial_sqlite.sql"
    v1_sql = v1_path.read_text(encoding="utf-8")
    conn.executescript(v1_sql)

    # Seed v1 data
    conn.execute(
        """
        INSERT INTO users (id, email, password_hash, display_name, created_at)
        VALUES ('u1', 'v1@test.com', 'hash', 'V1 User', '2026-10-20T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO spaces (id, owner_id, name, created_at)
        VALUES ('s1', 'u1', 'V1 Space', '2026-10-20T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO branches (id, space_id, name, created_at)
        VALUES ('b1', 's1', 'main', '2026-10-20T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO commits (id, space_id, branch_id, role, content, created_at)
        VALUES ('c1', 's1', 'b1', 'anchor', '', '2026-10-20T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO memories (
            id, space_id, origin_branch_id, source_commit_id, content, created_at
        )
        VALUES ('m1', 's1', 'b1', 'c1', 'Legacy memory content', '2026-10-20T00:00:00Z')
        """
    )
    conn.commit()
    conn.close()

    # Now run migrations via Database.initialize()
    db = Database(db_file)
    db.initialize()

    conn2 = db.connect()
    try:
        user_row = conn2.execute("SELECT email FROM users WHERE id = 'u1'").fetchone()
        assert user_row["email"] == "v1@test.com"

        query = "SELECT content, version, status FROM memories WHERE id = 'm1'"
        mem_row = conn2.execute(query).fetchone()
        assert mem_row["content"] == "Legacy memory content"
        assert mem_row["version"] == 1
        assert mem_row["status"] == "active"
    finally:
        conn2.close()
