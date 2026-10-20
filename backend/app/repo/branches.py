from __future__ import annotations

import sqlite3
from typing import Any

from app.clock import new_id, utc_now
from app.errors import not_found

BRANCH_COLORS = (
    "#C96442",
    "#5B7F67",
    "#6A6FB0",
    "#B07A4F",
    "#8A5A83",
    "#4F7E8C",
    "#9A6B3F",
    "#6F7D42",
)


def require_owned(
    conn: sqlite3.Connection, branch_id: str, owner_id: str
) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT branches.*
        FROM branches
        JOIN spaces ON spaces.id = branches.space_id
        WHERE branches.id = ? AND spaces.owner_id = ?
        """,
        (branch_id, owner_id),
    ).fetchone()
    if row is None:
        raise not_found()
    return row


def list_for_space(conn: sqlite3.Connection, space_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM branches WHERE space_id = ? ORDER BY created_at ASC",
            (space_id,),
        ).fetchall()
    )


def create(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    name: str,
    parent_branch_id: str | None = None,
    fork_commit_id: str | None = None,
    system_prompt: str = "",
    persona: str = "",
    model: str | None = None,
    thinking_level: str = "medium",
    top_k: int = 6,
    memory_mode: str = "review",
    color: str | None = None,
    archived: bool = False,
) -> tuple[sqlite3.Row, sqlite3.Row]:
    branch_id = new_id()
    anchor_id = new_id()
    now = utc_now()
    if color is None:
        count = conn.execute(
            "SELECT COUNT(*) FROM branches WHERE space_id = ?", (space_id,)
        ).fetchone()[0]
        color = BRANCH_COLORS[int(count) % len(BRANCH_COLORS)]

    with conn:
        conn.execute(
            """
            INSERT INTO branches(
                id, space_id, name, parent_branch_id, fork_commit_id, head_commit_id,
                system_prompt, persona, model, thinking_level, top_k, memory_mode,
                color, archived, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                branch_id,
                space_id,
                name,
                parent_branch_id,
                fork_commit_id,
                anchor_id,
                system_prompt,
                persona,
                model,
                thinking_level,
                top_k,
                memory_mode,
                color,
                int(archived),
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO commits(
                id, space_id, branch_id, parent_id, role, content, status, created_at
            ) VALUES (?, ?, ?, ?, 'anchor', '', 'complete', ?)
            """,
            (anchor_id, space_id, branch_id, fork_commit_id, now),
        )

    branch = conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()
    anchor = conn.execute("SELECT * FROM commits WHERE id = ?", (anchor_id,)).fetchone()
    assert branch is not None and anchor is not None
    return branch, anchor


def update_settings(
    conn: sqlite3.Connection,
    branch_id: str,
    owner_id: str,
    values: dict[str, Any],
) -> sqlite3.Row:
    require_owned(conn, branch_id, owner_id)
    allowed = {
        "name",
        "system_prompt",
        "persona",
        "model",
        "thinking_level",
        "top_k",
        "memory_mode",
        "color",
        "archived",
    }
    sets: list[str] = []
    params: list[Any] = []
    for key, value in values.items():
        if key not in allowed:
            continue
        sets.append(f"{key} = ?")
        params.append(value)
    if sets:
        params.append(branch_id)
        conn.execute(f"UPDATE branches SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    return require_owned(conn, branch_id, owner_id)
