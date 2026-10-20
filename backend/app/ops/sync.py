from __future__ import annotations

import json
import sqlite3
from typing import Any

from app.clock import new_id, utc_now
from app.errors import ApiError
from app.llm.base import LLMProvider
from app.llm.embeddings import to_blob
from app.models import (
    DuplicateMatchOut,
    SyncPreviewOut,
    SyncRequest,
    SyncResultOut,
)
from app.ops.common import build_copy_plan
from app.repo import branches as branches_repo
from app.repo import memories as memories_repo
from app.viewmodels import branch_out, memory_out
from app.visibility import effective_memories, visible_commit_ids


def load_parent(conn: sqlite3.Connection, source: sqlite3.Row, owner_id: str) -> sqlite3.Row:
    parent_id = source["parent_branch_id"]
    if parent_id is None:
        raise ApiError(
            409,
            "root_has_no_parent",
            "The root branch has no upstream branch to sync from",
        )
    parent = branches_repo.require_owned(conn, parent_id, owner_id)
    if parent["space_id"] != source["space_id"]:
        raise ApiError(404, "not_found", "Branch not found")
    if source["archived"] or parent["archived"]:
        raise ApiError(409, "branch_archived", "Archived branches cannot be synced")
    return parent


def sync_candidates(
    conn: sqlite3.Connection, source: sqlite3.Row, parent: sqlite3.Row
) -> list[dict[str, Any]]:
    source_visible = visible_commit_ids(conn, source)
    return [
        item
        for item in effective_memories(conn, parent)
        if item["source_commit_id"] not in source_visible
    ]


def _selected_candidates(
    candidates: list[dict[str, Any]], memory_ids: list[str]
) -> list[dict[str, Any]]:
    by_id = {item["id"]: item for item in candidates}
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for memory_id in memory_ids:
        if memory_id in seen:
            continue
        seen.add(memory_id)
        item = by_id.get(memory_id)
        if item is None:
            raise ApiError(
                422,
                "memory_not_syncable",
                "A selected memory is not new upstream",
            )
        selected.append(item)
    return selected


def _duplicates(plan_duplicates: list[dict[str, Any]]) -> list[DuplicateMatchOut]:
    return [DuplicateMatchOut(**item) for item in plan_duplicates]


async def preview_sync(
    conn: sqlite3.Connection,
    provider: LLMProvider,
    source: sqlite3.Row,
    parent: sqlite3.Row,
) -> SyncPreviewOut:
    candidates = sync_candidates(conn, source, parent)
    target_items = effective_memories(conn, source)
    plan = await build_copy_plan(provider, candidates, target_items)
    return SyncPreviewOut(
        branch_id=source["id"],
        parent_branch_id=parent["id"],
        parent_name=parent["name"],
        parent_head_commit_id=parent["head_commit_id"],
        memories=[
            memory_out(
                item,
                provider=provider,
                origin_branch_name=item.get("origin_branch_name"),
            )
            for item in candidates
        ],
        duplicates=_duplicates(plan.duplicates),
        warnings=plan.warnings,
    )


async def sync_memories(
    conn: sqlite3.Connection,
    provider: LLMProvider,
    source: sqlite3.Row,
    parent: sqlite3.Row,
    payload: SyncRequest,
) -> SyncResultOut:
    candidates = sync_candidates(conn, source, parent)
    selected = _selected_candidates(candidates, payload.memory_ids)
    target_items = effective_memories(conn, source)
    plan = await build_copy_plan(provider, selected, target_items)
    if not plan.copies:
        raise ApiError(
            409,
            "nothing_to_sync",
            "The selected memories already exist on this branch",
        )

    expected_head = payload.expected_head_id or source["head_commit_id"]
    commit_id = new_id()
    now = utc_now()
    content = f"Synced {len(plan.copies)} memories from {parent['name']}."
    operations: list[dict[str, Any]] = []
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO commits(
                    id, space_id, branch_id, parent_id, role, content, status,
                    source_branch_id, created_at
                ) VALUES (?, ?, ?, ?, 'sync', ?, 'complete', ?, ?)
                """,
                (
                    commit_id,
                    source["space_id"],
                    source["id"],
                    expected_head,
                    content,
                    parent["id"],
                    now,
                ),
            )
            cursor = conn.execute(
                """
                UPDATE branches SET head_commit_id = ?
                WHERE id = ? AND head_commit_id = ?
                """,
                (commit_id, source["id"], expected_head),
            )
            if cursor.rowcount != 1:
                raise ApiError(
                    409,
                    "head_conflict",
                    "The branch changed while syncing. Refresh and try again.",
                )
            for item, vector in plan.copies:
                copied = memories_repo.create(
                    conn,
                    space_id=source["space_id"],
                    origin_branch_id=source["id"],
                    source_commit_id=commit_id,
                    content=item["content"],
                    kind=item.get("kind", "fact"),
                    importance=float(item.get("importance", 0.5)),
                    embedding=to_blob(vector) if vector is not None else None,
                    embedding_model=(provider.embed_model if vector is not None else None),
                    embedding_dim=(provider.embed_dim if vector is not None else None),
                    derived_from_id=item["id"],
                    commit=False,
                )
                operations.append(
                    {
                        "op": "memory_synced",
                        "memory_id": copied["id"],
                        "derived_from_id": item["id"],
                        "content": item["content"],
                    }
                )
            trace = {
                "version": 1,
                "kind": "sync",
                "source_branch_id": parent["id"],
                "sync_commit_id": commit_id,
                "memory_operations": operations,
                "duplicates": plan.duplicates,
                "warnings": plan.warnings,
                "created_at": now,
            }
            conn.execute(
                "UPDATE commits SET trace_json = ? WHERE id = ?",
                (
                    json.dumps(trace, ensure_ascii=False, separators=(",", ":")),
                    commit_id,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ApiError(409, "sync_conflict", "The sync could not be persisted") from exc

    updated = conn.execute("SELECT * FROM branches WHERE id = ?", (source["id"],)).fetchone()
    assert updated is not None
    return SyncResultOut(
        branch_id=source["id"],
        parent_branch_id=parent["id"],
        sync_commit_id=commit_id,
        copied_count=len(plan.copies),
        duplicates=_duplicates(plan.duplicates),
        warnings=plan.warnings,
        branch=branch_out(conn, updated),
    )
