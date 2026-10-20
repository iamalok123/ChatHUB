from __future__ import annotations

import sqlite3

from app.clock import new_id, utc_now


def create(
    conn: sqlite3.Connection,
    *,
    branch_id: str,
    commit_id: str,
    name: str,
) -> sqlite3.Row:
    checkpoint_id = new_id()
    conn.execute(
        """
        INSERT INTO checkpoints(id, branch_id, commit_id, name, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (checkpoint_id, branch_id, commit_id, name, utc_now()),
    )
    conn.commit()
    row = get(conn, checkpoint_id)
    assert row is not None
    return row


def get(conn: sqlite3.Connection, checkpoint_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT checkpoints.*, commits.role AS commit_role, commits.content AS commit_content
        FROM checkpoints
        JOIN commits ON commits.id = checkpoints.commit_id
        WHERE checkpoints.id = ?
        """,
        (checkpoint_id,),
    ).fetchone()


def list_for_branch(
    conn: sqlite3.Connection, branch_id: str
) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT checkpoints.*, commits.role AS commit_role,
                   commits.content AS commit_content
            FROM checkpoints
            JOIN commits ON commits.id = checkpoints.commit_id
            WHERE checkpoints.branch_id = ?
            ORDER BY checkpoints.created_at DESC, checkpoints.id DESC
            """,
            (branch_id,),
        ).fetchall()
    )
