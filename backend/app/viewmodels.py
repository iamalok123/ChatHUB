from __future__ import annotations

import json
import sqlite3

from app.models import BranchOut, MessageOut
from app.repo import commits as commits_repo
from app.visibility import effective_memories, visible_commit_chain


def branch_out(conn: sqlite3.Connection, branch: sqlite3.Row) -> BranchOut:
    visible_ids = [row["id"] for row in visible_commit_chain(conn, branch)]
    return BranchOut(
        id=branch["id"],
        space_id=branch["space_id"],
        name=branch["name"],
        parent_branch_id=branch["parent_branch_id"],
        fork_commit_id=branch["fork_commit_id"],
        head_commit_id=branch["head_commit_id"],
        system_prompt=branch["system_prompt"] or "",
        persona=branch["persona"] or "",
        model=branch["model"],
        thinking_level=branch["thinking_level"],
        top_k=branch["top_k"],
        memory_mode=branch["memory_mode"],
        color=branch["color"],
        archived=bool(branch["archived"]),
        created_at=branch["created_at"],
        is_root=branch["parent_branch_id"] is None,
        message_count=commits_repo.count_messages(conn, visible_ids),
        memory_count=len(effective_memories(conn, branch)),
    )


def message_out(
    conn: sqlite3.Connection, branch: sqlite3.Row, commit: sqlite3.Row
) -> MessageOut:
    origin = conn.execute(
        "SELECT name FROM branches WHERE id = ?", (commit["branch_id"],)
    ).fetchone()
    return MessageOut(
        id=commit["id"],
        role=commit["role"],
        content=commit["content"],
        parent_id=commit["parent_id"],
        branch_id=commit["branch_id"],
        origin_branch_name=origin["name"] if origin else "unknown",
        is_inherited=commit["branch_id"] != branch["id"],
        status=commit["status"] or "complete",
        created_at=commit["created_at"],
    )


def parse_trace(raw: str | None) -> tuple[dict | None, int | None]:
    if not raw:
        return None, None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None, None
    if not isinstance(value, dict):
        return None, None
    version = value.get("version")
    return value, int(version) if isinstance(version, int) else None
