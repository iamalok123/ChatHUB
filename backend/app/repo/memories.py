from __future__ import annotations

import sqlite3
from typing import Any

from app.engine.memory_service import MemoryService


def create(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    origin_branch_id: str,
    source_commit_id: str,
    content: str,
    kind: str = "fact",
    importance: float = 0.5,
    embedding: bytes | None = None,
    embedding_model: str | None = None,
    embedding_dim: int | None = None,
    supersedes_id: str | None = None,
    derived_from_id: str | None = None,
    confidence: float = 1.0,
    source_type: str = "user_stated",
    sensitivity: str = "none",
    subject_key: str | None = None,
    commit: bool = True,
) -> sqlite3.Row | dict[str, Any]:
    created = MemoryService.create_memory(
        conn,
        space_id=space_id,
        origin_branch_id=origin_branch_id,
        source_commit_id=source_commit_id,
        content=content,
        kind=kind,
        importance=importance,
        embedding=embedding,
        embedding_model=embedding_model,
        embedding_dim=embedding_dim,
        supersedes_id=supersedes_id,
        derived_from_id=derived_from_id,
        confidence=confidence,
        source_type=source_type,
        sensitivity=sensitivity,
        subject_key=subject_key,
        commit=commit,
    )
    row = get(conn, created["id"])
    assert row is not None
    return row


def get(conn: sqlite3.Connection, memory_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()


def update(
    conn: sqlite3.Connection,
    memory_id: str,
    *,
    content: str,
    kind: str,
    importance: float,
    embedding: bytes | None,
    embedding_model: str | None,
    embedding_dim: int | None,
    sensitivity: str | None = None,
    subject_key: str | None = None,
) -> sqlite3.Row:
    MemoryService.update_memory(
        conn,
        memory_id,
        content=content,
        kind=kind,
        importance=importance,
        embedding=embedding,
        embedding_model=embedding_model,
        embedding_dim=embedding_dim,
        sensitivity=sensitivity,
        subject_key=subject_key,
        commit=True,
    )
    row = get(conn, memory_id)
    assert row is not None
    return row


def soft_delete(conn: sqlite3.Connection, memory_id: str) -> None:
    row = get(conn, memory_id)
    if row is not None:
        branch_id = row["origin_branch_id"]
        MemoryService.tombstone_memory(conn, memory_id, branch_id=branch_id, commit=True)


def set_override(
    conn: sqlite3.Connection,
    branch_id: str,
    memory_id: str,
    *,
    excluded: int | None = None,
    pinned: int | None = None,
    content_override: str | None = None,
    clear_excluded: bool = False,
    clear_pinned: bool = False,
    clear_content: bool = False,
) -> None:
    MemoryService.set_override(
        conn,
        branch_id,
        memory_id,
        excluded=excluded,
        pinned=pinned,
        content_override=content_override,
        clear_excluded=clear_excluded,
        clear_pinned=clear_pinned,
        clear_content=clear_content,
        commit=True,
    )
