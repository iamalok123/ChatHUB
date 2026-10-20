from __future__ import annotations

import sqlite3

from app.clock import new_id, utc_now


def create(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    origin_branch_id: str,
    source_commit_id: str,
    content: str,
    kind: str = "fact",
    importance: float = 0.5,
    embedding: bytes | None = None,
    embedding_model: str | None = None,
    embedding_dim: int | None = None,
    supersedes_id: str | None = None,
    derived_from_id: str | None = None,
) -> sqlite3.Row:
    memory_id = new_id()
    conn.execute(
        """
        INSERT INTO memories(
            id, space_id, origin_branch_id, source_commit_id, content, kind, importance,
            embedding, embedding_model, embedding_dim, supersedes_id, derived_from_id,
            deleted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        """,
        (
            memory_id,
            space_id,
            origin_branch_id,
            source_commit_id,
            content,
            kind,
            importance,
            embedding,
            embedding_model,
            embedding_dim,
            supersedes_id,
            derived_from_id,
            utc_now(),
        ),
    )
    conn.commit()
    row = get(conn, memory_id)
    assert row is not None
    return row


def get(conn: sqlite3.Connection, memory_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()


def soft_delete(conn: sqlite3.Connection, memory_id: str) -> None:
    conn.execute(
        "UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
        (utc_now(), memory_id),
    )
    conn.commit()


def set_override(
    conn: sqlite3.Connection,
    branch_id: str,
    memory_id: str,
    *,
    excluded: int | None = None,
    pinned: int | None = None,
    content_override: str | None = None,
    clear_excluded: bool = False,
    clear_pinned: bool = False,
    clear_content: bool = False,
) -> None:
    existing = conn.execute(
        "SELECT * FROM memory_overrides WHERE branch_id = ? AND memory_id = ?",
        (branch_id, memory_id),
    ).fetchone()
    if existing is None:
        conn.execute(
            """
            INSERT INTO memory_overrides(
                branch_id, memory_id, excluded, pinned, content_override, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                branch_id,
                memory_id,
                excluded,
                pinned,
                content_override,
                utc_now(),
            ),
        )
    else:
        new_excluded = (
            None
            if clear_excluded
            else (excluded if excluded is not None else existing["excluded"])
        )
        new_pinned = (
            None if clear_pinned else (pinned if pinned is not None else existing["pinned"])
        )
        new_content = (
            None
            if clear_content
            else (
                content_override
                if content_override is not None
                else existing["content_override"]
            )
        )
        conn.execute(
            """
            UPDATE memory_overrides
            SET excluded = ?, pinned = ?, content_override = ?, updated_at = ?
            WHERE branch_id = ? AND memory_id = ?
            """,
            (new_excluded, new_pinned, new_content, utc_now(), branch_id, memory_id),
        )
    conn.commit()
