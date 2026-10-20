from __future__ import annotations

import json
import sqlite3
from typing import Any

from app.clock import new_id, utc_now
from app.errors import not_found

ROOT_BRANCH_COLOR = "#C96442"


def _profile(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"] or "",
        "profile": _profile(row["profile_json"]),
        "created_at": row["created_at"],
    }


def require_owned(conn: sqlite3.Connection, space_id: str, owner_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM spaces WHERE id = ? AND owner_id = ?", (space_id, owner_id)
    ).fetchone()
    if row is None:
        raise not_found()
    return row


def list_owned(conn: sqlite3.Connection, owner_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM spaces WHERE owner_id = ? ORDER BY created_at ASC", (owner_id,)
        ).fetchall()
    )


def create_with_main(
    conn: sqlite3.Connection,
    owner_id: str,
    name: str,
    description: str,
    profile: dict[str, Any],
    memory_mode: str = "auto",
) -> tuple[sqlite3.Row, sqlite3.Row]:
    space_id = new_id()
    branch_id = new_id()
    anchor_id = new_id()
    now = utc_now()

    with conn:
        conn.execute(
            """
            INSERT INTO spaces(id, owner_id, name, description, profile_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                space_id,
                owner_id,
                name,
                description,
                json.dumps(profile, ensure_ascii=False, separators=(",", ":")),
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO branches(
                id, space_id, name, parent_branch_id, fork_commit_id, head_commit_id,
                system_prompt, persona, model, thinking_level, top_k, memory_mode,
                color, archived, created_at
            ) VALUES (?, ?, 'main', NULL, NULL, ?, '', '', NULL, 'medium', 6, ?, ?, 0, ?)
            """,
            (branch_id, space_id, anchor_id, memory_mode, ROOT_BRANCH_COLOR, now),
        )
        conn.execute(
            """
            INSERT INTO commits(
                id, space_id, branch_id, parent_id, role, content, status, created_at
            ) VALUES (?, ?, ?, NULL, 'anchor', '', 'complete', ?)
            """,
            (anchor_id, space_id, branch_id, now),
        )

    space = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
    branch = conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()
    assert space is not None and branch is not None
    return space, branch


def update(
    conn: sqlite3.Connection,
    space_id: str,
    owner_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    profile: dict[str, Any] | None = None,
) -> sqlite3.Row:
    require_owned(conn, space_id, owner_id)
    sets: list[str] = []
    params: list[Any] = []
    if name is not None:
        sets.append("name = ?")
        params.append(name)
    if description is not None:
        sets.append("description = ?")
        params.append(description)
    if profile is not None:
        sets.append("profile_json = ?")
        params.append(json.dumps(profile, ensure_ascii=False, separators=(",", ":")))
    if sets:
        params.extend([space_id, owner_id])
        conn.execute(
            f"UPDATE spaces SET {', '.join(sets)} WHERE id = ? AND owner_id = ?",
            params,
        )
        conn.commit()
    return require_owned(conn, space_id, owner_id)


def delete(conn: sqlite3.Connection, space_id: str, owner_id: str) -> None:
    require_owned(conn, space_id, owner_id)
    conn.execute("DELETE FROM spaces WHERE id = ? AND owner_id = ?", (space_id, owner_id))
    conn.commit()


def main_branch(conn: sqlite3.Connection, space_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM branches
        WHERE space_id = ? AND parent_branch_id IS NULL
        ORDER BY created_at ASC LIMIT 1
        """,
        (space_id,),
    ).fetchone()
