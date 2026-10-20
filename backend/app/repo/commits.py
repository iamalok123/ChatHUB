from __future__ import annotations

import sqlite3
from typing import Any

from app.clock import new_id, utc_now


class HeadConflict(Exception):
    def __init__(self, branch_id: str, current_head_id: str | None) -> None:
        super().__init__("Branch head changed")
        self.branch_id = branch_id
        self.current_head_id = current_head_id


def get(conn: sqlite3.Connection, commit_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM commits WHERE id = ?", (commit_id,)).fetchone()


def append_at_head(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    branch_id: str,
    expected_head_id: str | None,
    role: str,
    content: str,
    status: str = "complete",
) -> sqlite3.Row:
    commit_id = new_id()
    now = utc_now()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO commits(
                    id, space_id, branch_id, parent_id, role, content, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    commit_id,
                    space_id,
                    branch_id,
                    expected_head_id,
                    role,
                    content,
                    status,
                    now,
                ),
            )
            if expected_head_id is None:
                cursor = conn.execute(
                    """
                    UPDATE branches SET head_commit_id = ?
                    WHERE id = ? AND head_commit_id IS NULL
                    """,
                    (commit_id, branch_id),
                )
            else:
                cursor = conn.execute(
                    """
                    UPDATE branches SET head_commit_id = ?
                    WHERE id = ? AND head_commit_id = ?
                    """,
                    (commit_id, branch_id, expected_head_id),
                )
            if cursor.rowcount != 1:
                raise HeadConflict(branch_id, None)
    except HeadConflict:
        current = conn.execute(
            "SELECT head_commit_id FROM branches WHERE id = ?", (branch_id,)
        ).fetchone()
        raise HeadConflict(branch_id, current["head_commit_id"] if current else None) from None
    row = get(conn, commit_id)
    assert row is not None
    return row


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


def update_trace(conn: sqlite3.Connection, commit_id: str, *, trace_json: str) -> None:
    conn.execute(
        "UPDATE commits SET trace_json = ? WHERE id = ?",
        (trace_json, commit_id),
    )
    conn.commit()


def list_events_for_space(conn: sqlite3.Connection, space_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT id, branch_id, role, source_branch_id, created_at
            FROM commits
            WHERE space_id = ? AND role IN ('merge', 'sync')
              AND source_branch_id IS NOT NULL
            ORDER BY created_at ASC, id ASC
            """,
            (space_id,),
        ).fetchall()
    )


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
