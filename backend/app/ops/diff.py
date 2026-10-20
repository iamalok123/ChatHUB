from __future__ import annotations

import sqlite3

from app.errors import ApiError, not_found
from app.llm.base import LLMProvider
from app.models import DiffOut, MemoryChangeOut
from app.viewmodels import memory_out, message_out
from app.visibility import (
    effective_memories,
    is_ancestor,
    visible_commit_chain,
    visible_messages,
)


def _latest_common_commit(
    conn: sqlite3.Connection,
    source: sqlite3.Row,
    against: sqlite3.Row,
) -> str | None:
    source_ids = {
        row["id"] for row in visible_commit_chain(conn, source)
    }
    for row in visible_commit_chain(conn, against):
        if row["id"] in source_ids:
            return str(row["id"])
    return None


def compute_diff(
    conn: sqlite3.Connection,
    provider: LLMProvider,
    source: sqlite3.Row,
    against: sqlite3.Row,
) -> DiffOut:
    if against["id"] == source["id"]:
        raise ApiError(422, "invalid_diff_target", "Choose an ancestor branch")
    if against["space_id"] != source["space_id"]:
        raise not_found()
    if not is_ancestor(conn, against["id"], source):
        raise ApiError(
            422,
            "invalid_diff_target",
            "Diff can only compare a branch with an ancestor",
        )
    baseline = _latest_common_commit(conn, source, against)
    if baseline is None:
        raise ApiError(
            409,
            "no_common_ancestor",
            "The branches do not share a common commit",
        )

    source_items = effective_memories(conn, source)
    previous_items = effective_memories(conn, against, head_override=baseline)
    source_by_id = {item["id"]: item for item in source_items}
    previous_by_id = {item["id"]: item for item in previous_items}

    added: list = []
    removed: list = []
    changed: list[MemoryChangeOut] = []
    for memory_id, item in source_by_id.items():
        before = previous_by_id.get(memory_id)
        if before is None:
            added.append(item)
        elif str(before.get("content", "")) != str(item.get("content", "")):
            changed.append(
                MemoryChangeOut(
                    before=memory_out(
                        before,
                        provider=provider,
                        origin_branch_name=before.get("origin_branch_name"),
                    ),
                    after=memory_out(
                        item,
                        provider=provider,
                        origin_branch_name=item.get("origin_branch_name"),
                    ),
                )
            )
    for memory_id, item in previous_by_id.items():
        if memory_id not in source_by_id:
            removed.append(item)

    source_messages = visible_messages(conn, source)
    previous_messages = visible_messages(conn, against)
    source_visible = {row["id"] for row in source_messages}
    previous_visible = {row["id"] for row in previous_messages}
    messages_added = [
        message_out(conn, source, row)
        for row in source_messages
        if row["id"] not in previous_visible
    ]
    messages_upstream = [
        message_out(conn, source, row)
        for row in previous_messages
        if row["id"] not in source_visible
    ]

    return DiffOut(
        branch_id=source["id"],
        against_branch_id=against["id"],
        against_name=against["name"],
        baseline_commit_id=baseline,
        added=[
            memory_out(
                item,
                provider=provider,
                origin_branch_name=item.get("origin_branch_name"),
            )
            for item in added
        ],
        removed=[
            memory_out(
                item,
                provider=provider,
                origin_branch_name=item.get("origin_branch_name"),
            )
            for item in removed
        ],
        changed=changed,
        messages_added=messages_added,
        messages_upstream=messages_upstream,
        added_count=len(added),
        removed_count=len(removed),
        changed_count=len(changed),
        messages_added_count=len(messages_added),
        messages_upstream_count=len(messages_upstream),
    )
