from __future__ import annotations

import sqlite3
from typing import Any

from app.clock import new_id, utc_now


def get(conn: sqlite3.Connection, commit_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM commits WHERE id = ?", (commit_id,)).fetchone()


def create(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    branch_id: str,
    role: str,
    content: str,
    parent_id: str | None = None,
    status: str = "complete",
    thinking: str | None = None,
    trace_json: str | None = None,
    provider_parts_json: str | None = None,
    thought_signature: str | None = None,
    usage_json: str | None = None,
    source_branch_id: str | None = None,
    advance_head: bool = True,
) -> sqlite3.Row:
    commit_id = new_id()
    now = utc_now()
    with conn:
        conn.execute(
            """
            INSERT INTO commits(
                id, space_id, branch_id, parent_id, role, content, thinking, trace_json,
                status, provider_parts_json, thought_signature, usage_json,
                source_branch_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                commit_id,
                space_id,
                branch_id,
                parent_id,
                role,
                content,
                thinking,
                trace_json,
                status,
                provider_parts_json,
                thought_signature,
                usage_json,
                source_branch_id,
                now,
            ),
        )
        if advance_head:
            conn.execute(
                "UPDATE branches SET head_commit_id = ? WHERE id = ?",
                (commit_id, branch_id),
            )
    row = get(conn, commit_id)
    assert row is not None
    return row


def update_payload(
    conn: sqlite3.Connection,
    commit_id: str,
    *,
    content: str,
    thinking: str | None,
    trace_json: str | None,
    status: str,
    provider_parts_json: str | None = None,
    thought_signature: str | None = None,
    usage_json: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE commits
        SET content = ?, thinking = ?, trace_json = ?, status = ?,
            provider_parts_json = COALESCE(?, provider_parts_json),
            thought_signature = COALESCE(?, thought_signature),
            usage_json = COALESCE(?, usage_json)
        WHERE id = ?
        """,
        (
            content,
            thinking,
            trace_json,
            status,
            provider_parts_json,
            thought_signature,
            usage_json,
            commit_id,
        ),
    )
    conn.commit()


def count_messages(conn: sqlite3.Connection, commit_ids: list[str]) -> int:
    if not commit_ids:
        return 0
    placeholders = ",".join("?" for _ in commit_ids)
    row: Any = conn.execute(
        f"""
        SELECT COUNT(*) FROM commits
        WHERE id IN ({placeholders}) AND role IN ('user', 'assistant')
        """,
        commit_ids,
    ).fetchone()
    return int(row[0])
