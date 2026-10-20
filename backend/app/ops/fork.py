from __future__ import annotations

import sqlite3
from typing import Any

from app.clock import utc_now
from app.config import Settings
from app.errors import ApiError
from app.llm.base import LLMProvider
from app.models import ForkPreviewOut, ForkRequest
from app.repo import branches as branches_repo
from app.viewmodels import memory_out
from app.visibility import effective_memories, require_visible_commit


def _fork_memories(
    conn: sqlite3.Connection,
    branch: sqlite3.Row,
    commit_id: str,
) -> tuple[sqlite3.Row, list[dict[str, Any]]]:
    commit = require_visible_commit(conn, branch, commit_id)
    memories = effective_memories(conn, branch, head_override=commit_id)
    return commit, memories


def _validate_choices(
    memories: list[dict[str, Any]],
    exclude_ids: list[str],
    pin_ids: list[str],
    unpin_ids: list[str],
) -> tuple[set[str], set[str], set[str]]:
    available = {item["id"] for item in memories}
    excluded = set(exclude_ids)
    pinned = set(pin_ids)
    unpinned = set(unpin_ids)
    if (
        not excluded.issubset(available)
        or not pinned.issubset(available)
        or not unpinned.issubset(available)
    ):
        raise ApiError(
            422,
            "invalid_memory_choice",
            "A selected memory is not available at this fork point",
        )
    if excluded & (pinned | unpinned) or pinned & unpinned:
        raise ApiError(
            422,
            "invalid_memory_choice",
            "A memory cannot be excluded, pinned and unpinned at the same time",
        )
    return excluded, pinned, unpinned


def preview_fork(
    conn: sqlite3.Connection,
    provider: LLMProvider,
    branch: sqlite3.Row,
    commit_id: str,
) -> ForkPreviewOut:
    commit, memories = _fork_memories(conn, branch, commit_id)
    items = [
        memory_out(
            item,
            provider=provider,
            origin_branch_name=item.get("origin_branch_name"),
        )
        for item in memories
    ]
    return ForkPreviewOut(
        source_branch_id=branch["id"],
        commit_id=commit["id"],
        commit_role=commit["role"],
        memories=items,
        pinned_count=sum(1 for item in items if item.pinned),
    )


def create_fork(
    conn: sqlite3.Connection,
    *,
    source: sqlite3.Row,
    commit_id: str,
    payload: ForkRequest,
    settings: Settings,
) -> sqlite3.Row:
    _commit, memories = _fork_memories(conn, source, commit_id)
    excluded, pinned, unpinned = _validate_choices(
        memories,
        payload.exclude_memory_ids,
        payload.pin_memory_ids,
        payload.unpin_memory_ids,
    )
    if payload.model is not None and payload.model not in settings.gemini_allowed_models:
        raise ApiError(
            422,
            "invalid_request",
            "model is not in GEMINI_ALLOWED_MODELS",
        )

    base_name = payload.name or f"{source['name']} fork"
    name = branches_repo.unique_name(conn, source["space_id"], base_name)
    branch, _anchor = branches_repo.create(
        conn,
        space_id=source["space_id"],
        name=name,
        parent_branch_id=source["id"],
        fork_commit_id=commit_id,
        system_prompt=(
            payload.system_prompt if payload.system_prompt is not None else source["system_prompt"]
        ),
        persona=(payload.persona if payload.persona is not None else source["persona"]),
        model=payload.model if payload.model is not None else source["model"],
        thinking_level=(
            payload.thinking_level
            if payload.thinking_level is not None
            else source["thinking_level"]
        ),
        top_k=payload.top_k if payload.top_k is not None else source["top_k"],
        memory_mode=(
            payload.memory_mode if payload.memory_mode is not None else source["memory_mode"]
        ),
    )
    if excluded or pinned or unpinned:
        now = utc_now()
        with conn:
            for memory_id in excluded:
                conn.execute(
                    """
                    INSERT INTO memory_overrides(
                        branch_id, memory_id, excluded, pinned,
                        content_override, updated_at
                    ) VALUES (?, ?, 1, NULL, NULL, ?)
                    """,
                    (branch["id"], memory_id, now),
                )
            for memory_id in pinned:
                conn.execute(
                    """
                    INSERT INTO memory_overrides(
                        branch_id, memory_id, excluded, pinned,
                        content_override, updated_at
                    ) VALUES (?, ?, NULL, 1, NULL, ?)
                    """,
                    (branch["id"], memory_id, now),
                )
            for memory_id in unpinned:
                conn.execute(
                    """
                    INSERT INTO memory_overrides(
                        branch_id, memory_id, excluded, pinned,
                        content_override, updated_at
                    ) VALUES (?, ?, NULL, 0, NULL, ?)
                    """,
                    (branch["id"], memory_id, now),
                )
    return branch
