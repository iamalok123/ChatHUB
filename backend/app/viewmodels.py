from __future__ import annotations

import json
import sqlite3

from app.llm.base import LLMProvider
from app.llm.embeddings import from_blob, is_stale_embedding
from app.models import BranchOut, MemoryOut, MessageOut, ProposalOut
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


def _value(item, key, default=None):
    try:
        return item[key]
    except (KeyError, IndexError, TypeError):
        return default


def memory_out(
    item,
    *,
    provider: LLMProvider,
    origin_branch_name: str | None = None,
    excluded: bool = False,
) -> MemoryOut:
    blob = _value(item, "embedding")
    has_embedding = blob is not None
    stale = has_embedding and is_stale_embedding(
        _value(item, "embedding_model"),
        _value(item, "embedding_dim"),
        provider.embed_model,
        provider.embed_dim,
    )
    if has_embedding and not stale:
        try:
            stale = from_blob(blob).size != provider.embed_dim
        except (TypeError, ValueError):
            stale = True
    importance = _value(item, "importance", 0.5)
    return MemoryOut(
        id=_value(item, "id"),
        content=_value(item, "content", ""),
        kind=_value(item, "kind") or "fact",
        importance=float(importance if importance is not None else 0.5),
        pinned=bool(_value(item, "pinned", False)),
        edited=bool(_value(item, "edited", False)),
        inherited=bool(_value(item, "inherited", False)),
        excluded=excluded,
        origin_branch_id=_value(item, "origin_branch_id", ""),
        origin_branch_name=(
            origin_branch_name
            or _value(item, "origin_branch_name")
            or "unknown"
        ),
        source_commit_id=_value(item, "source_commit_id", ""),
        supersedes_id=_value(item, "supersedes_id"),
        derived_from_id=_value(item, "derived_from_id"),
        has_embedding=has_embedding,
        stale_embedding=stale or not has_embedding,
        created_at=_value(item, "created_at", ""),
    )


def proposal_out(row) -> ProposalOut:
    return ProposalOut(
        id=row["id"],
        branch_id=row["branch_id"],
        commit_id=row["commit_id"],
        content=row["content"],
        kind=row["kind"] or "fact",
        importance=float(
            row["importance"] if row["importance"] is not None else 0.5
        ),
        status=row["status"],
        reason=row["reason"] or "",
        conflicts_with_memory_id=row["conflicts_with_memory_id"],
        conflict_content=_value(row, "conflict_content"),
        conflict_kind=_value(row, "conflict_kind"),
        accepted_memory_id=row["accepted_memory_id"],
        resolution=row["resolution"],
        created_at=row["created_at"],
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
