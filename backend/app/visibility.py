from __future__ import annotations

import copy
import sqlite3
from typing import Any

from app.errors import not_found
from app.repo import commits

QUERY_CHUNK = 800


def visible_commit_chain(
    conn: sqlite3.Connection,
    branch: sqlite3.Row,
    head_override: str | None = None,
) -> list[sqlite3.Row]:
    cursor = head_override or branch["head_commit_id"]
    seen: set[str] = set()
    chain: list[sqlite3.Row] = []
    while cursor and cursor not in seen:
        seen.add(cursor)
        row = conn.execute(
            "SELECT * FROM commits WHERE id = ? AND space_id = ?",
            (cursor, branch["space_id"]),
        ).fetchone()
        if row is None:
            break
        chain.append(row)
        cursor = row["parent_id"]
    return chain


def visible_commit_ids(
    conn: sqlite3.Connection, branch: sqlite3.Row, head_override: str | None = None
) -> set[str]:
    return {row["id"] for row in visible_commit_chain(conn, branch, head_override)}


def visible_messages(
    conn: sqlite3.Connection, branch: sqlite3.Row, head_override: str | None = None
) -> list[sqlite3.Row]:
    chain = visible_commit_chain(conn, branch, head_override)
    messages = [row for row in chain if row["role"] in {"user", "assistant"}]
    return list(reversed(messages))


def lineage(conn: sqlite3.Connection, branch: sqlite3.Row) -> list[sqlite3.Row]:
    chain: list[sqlite3.Row] = []
    seen: set[str] = set()
    current: sqlite3.Row | None = branch
    while current is not None and current["id"] not in seen:
        seen.add(current["id"])
        chain.append(current)
        parent_id = current["parent_branch_id"]
        if not parent_id:
            break
        current = conn.execute(
            "SELECT * FROM branches WHERE id = ? AND space_id = ?",
            (parent_id, branch["space_id"]),
        ).fetchone()
    chain.reverse()
    return chain


def is_ancestor(conn: sqlite3.Connection, ancestor_id: str, branch: sqlite3.Row) -> bool:
    return any(row["id"] == ancestor_id for row in lineage(conn, branch))


def _memories_for_commits(
    conn: sqlite3.Connection, space_id: str, commit_ids: set[str]
) -> list[sqlite3.Row]:
    ids = list(commit_ids)
    rows: list[sqlite3.Row] = []
    for offset in range(0, len(ids), QUERY_CHUNK):
        chunk = ids[offset : offset + QUERY_CHUNK]
        placeholders = ",".join("?" for _ in chunk)
        rows.extend(
            conn.execute(
                f"""
                SELECT * FROM memories
                WHERE space_id = ? AND deleted_at IS NULL
                  AND source_commit_id IN ({placeholders})
                """,
                [space_id, *chunk],
            ).fetchall()
        )
    return rows


def effective_memories(
    conn: sqlite3.Connection,
    branch: sqlite3.Row,
    head_override: str | None = None,
) -> list[dict[str, Any]]:
    visible = visible_commit_ids(conn, branch, head_override)
    raw_rows = _memories_for_commits(conn, branch["space_id"], visible)

    superseded = {row["supersedes_id"] for row in raw_rows if row["supersedes_id"] is not None}
    base: dict[str, dict[str, Any]] = {}
    for row in raw_rows:
        if row["id"] in superseded:
            continue
        item = dict(row)
        item["pinned"] = False
        item["edited"] = False
        item["inherited"] = row["origin_branch_id"] != branch["id"]
        base[row["id"]] = item

    origin_ids = {item["origin_branch_id"] for item in base.values()}
    names: dict[str, str] = {}
    if origin_ids:
        placeholders = ",".join("?" for _ in origin_ids)
        for row in conn.execute(
            f"SELECT id, name FROM branches WHERE id IN ({placeholders})",
            list(origin_ids),
        ).fetchall():
            names[row["id"]] = row["name"]

    result: dict[str, dict[str, Any]] = {
        memory_id: copy.deepcopy(item) for memory_id, item in base.items()
    }

    for owner in lineage(conn, branch):
        overrides = conn.execute(
            "SELECT * FROM memory_overrides WHERE branch_id = ?", (owner["id"],)
        ).fetchall()
        for override in overrides:
            memory_id = override["memory_id"]
            if override["excluded"] == 1:
                result.pop(memory_id, None)
                continue
            if override["excluded"] == 0 and memory_id in base:
                result[memory_id] = copy.deepcopy(base[memory_id])
            item = result.get(memory_id)
            if item is None:
                continue
            if override["pinned"] is not None:
                item["pinned"] = bool(override["pinned"])
            if override["content_override"] is not None:
                item["content"] = override["content_override"]
                item["edited"] = True

    for item in result.values():
        item["origin_branch_name"] = names.get(item["origin_branch_id"], "unknown")

    return sorted(result.values(), key=lambda item: (item["created_at"], item["id"]))


def effective_memory_ids(
    conn: sqlite3.Connection, branch: sqlite3.Row, head_override: str | None = None
) -> set[str]:
    return {item["id"] for item in effective_memories(conn, branch, head_override=head_override)}


def require_visible_commit(
    conn: sqlite3.Connection, branch: sqlite3.Row, commit_id: str
) -> sqlite3.Row:
    row = commits.get(conn, commit_id)
    if row is None or row["space_id"] != branch["space_id"]:
        raise not_found()
    if commit_id not in visible_commit_ids(conn, branch):
        raise not_found()
    return row


def excluded_memories(conn: sqlite3.Connection, branch: sqlite3.Row) -> list[dict[str, Any]]:
    visible = visible_commit_ids(conn, branch)
    raw_rows = _memories_for_commits(conn, branch["space_id"], visible)
    base = {row["id"]: dict(row) for row in raw_rows}
    excluded_ids: set[str] = set()
    for owner in lineage(conn, branch):
        for override in conn.execute(
            "SELECT * FROM memory_overrides WHERE branch_id = ?", (owner["id"],)
        ).fetchall():
            if override["excluded"] == 1:
                excluded_ids.add(override["memory_id"])
            elif override["excluded"] == 0:
                excluded_ids.discard(override["memory_id"])
    result: list[dict[str, Any]] = []
    for memory_id in excluded_ids:
        item = base.get(memory_id)
        if item is not None:
            item["excluded"] = True
            result.append(item)
    return sorted(result, key=lambda item: (item["created_at"], item["id"]))


def tombstoned_memories(conn: sqlite3.Connection, branch: sqlite3.Row) -> list[dict[str, Any]]:
    visible_commits = visible_commit_ids(conn, branch)
    if not visible_commits:
        return []

    ids = list(visible_commits)
    tombstones: list[dict[str, Any]] = []

    kept_derived_ids = {
        row["derived_from_id"]
        for row in conn.execute(
            """
            SELECT derived_from_id FROM memories
            WHERE origin_branch_id = ? AND derived_from_id IS NOT NULL AND deleted_at IS NULL
            """,
            (branch["id"],),
        ).fetchall()
    }

    for offset in range(0, len(ids), QUERY_CHUNK):
        chunk = ids[offset : offset + QUERY_CHUNK]
        placeholders = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"""
            SELECT * FROM memories
            WHERE space_id = ?
                AND deleted_at IS NOT NULL
                AND origin_branch_id != ?
                AND source_commit_id IN ({placeholders})
            """,
            [branch["space_id"], branch["id"], *chunk],
        ).fetchall()
        for row in rows:
            if row["id"] not in kept_derived_ids:
                item = {
                    "id": row["id"],
                    "content": row["content"],
                    "kind": row["kind"],
                    "importance": row["importance"],
                    "origin_branch_id": row["origin_branch_id"],
                    "status": "tombstoned",
                    "reason": "Removed upstream",
                    "deleted_at": row["deleted_at"],
                    "created_at": row["created_at"],
                }
                tombstones.append(item)

    return tombstones
