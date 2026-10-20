from __future__ import annotations

import sqlite3

from app.clock import new_id, utc_now


def create(
    conn: sqlite3.Connection,
    *,
    branch_id: str,
    commit_id: str,
    content: str,
    kind: str,
    importance: float,
    conflicts_with_memory_id: str | None = None,
    reason: str = "",
) -> sqlite3.Row:
    proposal_id = new_id()
    conn.execute(
        """
        INSERT INTO memory_proposals(
            id, branch_id, commit_id, content, kind, importance,
            conflicts_with_memory_id, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (
            proposal_id,
            branch_id,
            commit_id,
            content,
            kind,
            importance,
            conflicts_with_memory_id,
            reason,
            utc_now(),
        ),
    )
    conn.commit()
    row = get(conn, proposal_id)
    assert row is not None
    return row


def get(conn: sqlite3.Connection, proposal_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT proposals.*, memories.content AS conflict_content,
               memories.kind AS conflict_kind
        FROM memory_proposals AS proposals
        LEFT JOIN memories ON memories.id = proposals.conflicts_with_memory_id
        WHERE proposals.id = ?
        """,
        (proposal_id,),
    ).fetchone()


def list_for_branch(
    conn: sqlite3.Connection, branch_id: str, *, status: str = "pending"
) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT proposals.*, memories.content AS conflict_content,
                   memories.kind AS conflict_kind
            FROM memory_proposals AS proposals
            LEFT JOIN memories
              ON memories.id = proposals.conflicts_with_memory_id
            WHERE proposals.branch_id = ? AND proposals.status = ?
            ORDER BY proposals.created_at ASC, proposals.id ASC
            """,
            (branch_id, status),
        ).fetchall()
    )


def resolve(
    conn: sqlite3.Connection,
    proposal_id: str,
    *,
    status: str,
    resolution: str,
    accepted_memory_id: str | None = None,
    commit: bool = True,
) -> sqlite3.Row | None:
    cursor = conn.execute(
        """
        UPDATE memory_proposals
        SET status = ?, resolution = ?, accepted_memory_id = ?, resolved_at = ?
        WHERE id = ? AND status = 'pending'
        """,
        (status, resolution, accepted_memory_id, utc_now(), proposal_id),
    )
    if cursor.rowcount != 1:
        return None
    if commit:
        conn.commit()
    return get(conn, proposal_id)
