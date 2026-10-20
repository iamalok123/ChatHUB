from __future__ import annotations

import base64
import binascii
import json
import sqlite3
from typing import Any

from app.clock import new_id, utc_now
from app.errors import ApiError
from app.models import (
    ExportBranch,
    ExportCheckpoint,
    ExportCommit,
    ExportMemory,
    ExportOverride,
    ExportProposal,
    ExportSpaceInfo,
    ImportResultOut,
    SpaceExport,
    SpaceOut,
)
from app.repo import spaces as spaces_repo


def _profile(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _embedding(value: Any) -> str | None:
    if value is None:
        return None
    return base64.b64encode(bytes(value)).decode("ascii")


def export_space(conn: sqlite3.Connection, space: sqlite3.Row) -> SpaceExport:
    owns_transaction = not conn.in_transaction
    if owns_transaction:
        conn.execute("BEGIN")
    try:
        payload = _export_space(conn, space)
    except BaseException:
        if owns_transaction:
            conn.rollback()
        raise
    if owns_transaction:
        conn.commit()
    return payload


def _export_space(conn: sqlite3.Connection, space: sqlite3.Row) -> SpaceExport:
    space_id = space["id"]
    branches = conn.execute(
        "SELECT * FROM branches WHERE space_id = ? ORDER BY created_at ASC, id ASC",
        (space_id,),
    ).fetchall()
    commits = conn.execute(
        "SELECT * FROM commits WHERE space_id = ? ORDER BY created_at ASC, id ASC",
        (space_id,),
    ).fetchall()
    memories = conn.execute(
        "SELECT * FROM memories WHERE space_id = ? ORDER BY created_at ASC, id ASC",
        (space_id,),
    ).fetchall()
    overrides = conn.execute(
        """
        SELECT memory_overrides.*
        FROM memory_overrides
        JOIN branches ON branches.id = memory_overrides.branch_id
        WHERE branches.space_id = ?
        ORDER BY memory_overrides.updated_at ASC, memory_overrides.branch_id ASC
        """,
        (space_id,),
    ).fetchall()
    proposals = conn.execute(
        """
        SELECT memory_proposals.*
        FROM memory_proposals
        JOIN branches ON branches.id = memory_proposals.branch_id
        WHERE branches.space_id = ?
        ORDER BY memory_proposals.created_at ASC, memory_proposals.id ASC
        """,
        (space_id,),
    ).fetchall()
    checkpoints = conn.execute(
        """
        SELECT checkpoints.*
        FROM checkpoints
        JOIN branches ON branches.id = checkpoints.branch_id
        WHERE branches.space_id = ?
        ORDER BY checkpoints.created_at ASC, checkpoints.id ASC
        """,
        (space_id,),
    ).fetchall()

    return SpaceExport(
        version=1,
        exported_at=utc_now(),
        space=ExportSpaceInfo(
            name=space["name"],
            description=space["description"] or "",
            profile=_profile(space["profile_json"]),
            created_at=space["created_at"],
        ),
        branches=[
            ExportBranch(
                id=row["id"],
                name=row["name"],
                parent_branch_id=row["parent_branch_id"],
                fork_commit_id=row["fork_commit_id"],
                head_commit_id=row["head_commit_id"],
                system_prompt=row["system_prompt"] or "",
                persona=row["persona"] or "",
                model=row["model"],
                thinking_level=row["thinking_level"],
                top_k=row["top_k"],
                memory_mode=row["memory_mode"],
                color=row["color"],
                archived=bool(row["archived"]),
                created_at=row["created_at"],
            )
            for row in branches
        ],
        commits=[
            ExportCommit(
                id=row["id"],
                branch_id=row["branch_id"],
                parent_id=row["parent_id"],
                role=row["role"],
                content=row["content"],
                thinking=row["thinking"],
                trace_json=row["trace_json"],
                status=row["status"],
                provider_parts_json=row["provider_parts_json"],
                thought_signature=row["thought_signature"],
                usage_json=row["usage_json"],
                source_branch_id=row["source_branch_id"],
                created_at=row["created_at"],
            )
            for row in commits
        ],
        memories=[
            ExportMemory(
                id=row["id"],
                origin_branch_id=row["origin_branch_id"],
                source_commit_id=row["source_commit_id"],
                content=row["content"],
                kind=row["kind"],
                importance=row["importance"],
                embedding=_embedding(row["embedding"]),
                embedding_model=row["embedding_model"],
                embedding_dim=row["embedding_dim"],
                supersedes_id=row["supersedes_id"],
                derived_from_id=row["derived_from_id"],
                deleted_at=row["deleted_at"],
                created_at=row["created_at"],
            )
            for row in memories
        ],
        overrides=[ExportOverride(**dict(row)) for row in overrides],
        proposals=[ExportProposal(**dict(row)) for row in proposals],
        checkpoints=[ExportCheckpoint(**dict(row)) for row in checkpoints],
    )


def _invalid(message: str) -> ApiError:
    return ApiError(422, "invalid_import", message)


def _validate(payload: SpaceExport) -> None:
    branch_ids = [branch.id for branch in payload.branches]
    commit_ids = [commit.id for commit in payload.commits]
    memory_ids = [memory.id for memory in payload.memories]
    if not branch_ids:
        raise _invalid("The import has no branches")
    if len(branch_ids) != len(set(branch_ids)):
        raise _invalid("Branch ids must be unique")
    if len(commit_ids) != len(set(commit_ids)):
        raise _invalid("Commit ids must be unique")
    if len(memory_ids) != len(set(memory_ids)):
        raise _invalid("Memory ids must be unique")

    branches = {branch.id: branch for branch in payload.branches}
    commits = {commit.id: commit for commit in payload.commits}
    memories = {memory.id: memory for memory in payload.memories}
    roots = [branch for branch in payload.branches if branch.parent_branch_id is None]
    if len(roots) != 1:
        raise _invalid("The import must contain exactly one root branch")
    if roots[0].fork_commit_id is not None:
        raise _invalid("The root branch cannot have a fork commit")

    for branch in payload.branches:
        if branch.head_commit_id is None or branch.head_commit_id not in commits:
            raise _invalid(f"Branch {branch.id} has an invalid head commit")
        if branch.parent_branch_id is not None:
            if branch.parent_branch_id not in branches:
                raise _invalid(f"Branch {branch.id} has an unknown parent")
            if branch.parent_branch_id == branch.id:
                raise _invalid("A branch cannot be its own parent")
        if branch.fork_commit_id is not None and branch.fork_commit_id not in commits:
            raise _invalid(f"Branch {branch.id} has an unknown fork commit")

    for branch in payload.branches:
        seen = {branch.id}
        current = branch.parent_branch_id
        while current is not None:
            if current in seen:
                raise _invalid("Branch relationships contain a cycle")
            seen.add(current)
            parent = branches.get(current)
            if parent is None:
                raise _invalid(f"Branch {current} does not exist")
            current = parent.parent_branch_id

    anchors: dict[str, int] = {}
    for commit in payload.commits:
        if commit.branch_id not in branches:
            raise _invalid(f"Commit {commit.id} has an unknown branch")
        if commit.parent_id is not None and commit.parent_id not in commits:
            raise _invalid(f"Commit {commit.id} has an unknown parent")
        if commit.role == "anchor":
            anchors[commit.branch_id] = anchors.get(commit.branch_id, 0) + 1
    for branch_id in branches:
        if anchors.get(branch_id, 0) != 1:
            raise _invalid(f"Branch {branch_id} must have exactly one anchor commit")

    for commit in payload.commits:
        seen = {commit.id}
        current = commit.parent_id
        while current is not None:
            if current in seen:
                raise _invalid("Commit relationships contain a cycle")
            seen.add(current)
            parent = commits.get(current)
            if parent is None:
                raise _invalid(f"Commit {current} does not exist")
            current = parent.parent_id

    for memory in payload.memories:
        if memory.origin_branch_id not in branches:
            raise _invalid(f"Memory {memory.id} has an unknown origin branch")
        if memory.source_commit_id not in commits:
            raise _invalid(f"Memory {memory.id} has an unknown source commit")
        if memory.supersedes_id is not None and memory.supersedes_id not in memories:
            raise _invalid(f"Memory {memory.id} supersedes an unknown memory")
        if memory.derived_from_id is not None and memory.derived_from_id not in memories:
            raise _invalid(f"Memory {memory.id} derives from an unknown memory")
        if memory.embedding is not None:
            try:
                base64.b64decode(memory.embedding, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise _invalid(f"Memory {memory.id} has an invalid embedding") from exc

    seen_overrides: set[tuple[str, str]] = set()
    for override in payload.overrides:
        if override.branch_id not in branches:
            raise _invalid("An override has an unknown branch")
        if override.memory_id not in memories:
            raise _invalid("An override has an unknown memory")
        key = (override.branch_id, override.memory_id)
        if key in seen_overrides:
            raise _invalid("A branch can only override a memory once")
        seen_overrides.add(key)

    for proposal in payload.proposals:
        if proposal.branch_id not in branches:
            raise _invalid("A proposal has an unknown branch")
        if proposal.commit_id not in commits:
            raise _invalid("A proposal has an unknown commit")
        if (
            proposal.conflicts_with_memory_id is not None
            and proposal.conflicts_with_memory_id not in memories
        ):
            raise _invalid("A proposal conflicts with an unknown memory")
        if proposal.accepted_memory_id is not None and proposal.accepted_memory_id not in memories:
            raise _invalid("A proposal references an unknown accepted memory")

    for checkpoint in payload.checkpoints:
        if checkpoint.branch_id not in branches:
            raise _invalid("A checkpoint has an unknown branch")
        if checkpoint.commit_id not in commits:
            raise _invalid("A checkpoint has an unknown commit")


def import_space(conn: sqlite3.Connection, owner_id: str, payload: SpaceExport) -> ImportResultOut:
    _validate(payload)
    space_id = new_id()
    branch_map = {branch.id: new_id() for branch in payload.branches}
    commit_map = {commit.id: new_id() for commit in payload.commits}
    memory_map = {memory.id: new_id() for memory in payload.memories}
    proposal_map = {proposal.id: new_id() for proposal in payload.proposals}
    checkpoint_map = {checkpoint.id: new_id() for checkpoint in payload.checkpoints}

    name = payload.space.name.strip()[:120] or "Imported space"
    description = payload.space.description[:4000]

    try:
        with conn:
            conn.execute("PRAGMA defer_foreign_keys = ON")
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
                    json.dumps(
                        payload.space.profile,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    payload.space.created_at,
                ),
            )
            for branch in payload.branches:
                conn.execute(
                    """
                    INSERT INTO branches(
                        id, space_id, name, parent_branch_id, fork_commit_id,
                        head_commit_id, system_prompt, persona, model,
                        thinking_level, top_k, memory_mode, color, archived, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        branch_map[branch.id],
                        space_id,
                        branch.name,
                        (branch_map[branch.parent_branch_id] if branch.parent_branch_id else None),
                        (commit_map[branch.fork_commit_id] if branch.fork_commit_id else None),
                        commit_map[branch.head_commit_id] if branch.head_commit_id else None,
                        branch.system_prompt,
                        branch.persona,
                        branch.model,
                        branch.thinking_level,
                        branch.top_k,
                        branch.memory_mode,
                        branch.color,
                        int(branch.archived),
                        branch.created_at,
                    ),
                )
            for commit in payload.commits:
                conn.execute(
                    """
                    INSERT INTO commits(
                        id, space_id, branch_id, parent_id, role, content, thinking,
                        trace_json, status, provider_parts_json, thought_signature,
                        usage_json, source_branch_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        commit_map[commit.id],
                        space_id,
                        branch_map[commit.branch_id],
                        commit_map[commit.parent_id] if commit.parent_id else None,
                        commit.role,
                        commit.content,
                        commit.thinking,
                        commit.trace_json,
                        commit.status,
                        commit.provider_parts_json,
                        commit.thought_signature,
                        commit.usage_json,
                        branch_map.get(commit.source_branch_id)
                        if commit.source_branch_id
                        else None,
                        commit.created_at,
                    ),
                )
            for memory in payload.memories:
                conn.execute(
                    """
                    INSERT INTO memories(
                        id, space_id, origin_branch_id, source_commit_id, content,
                        kind, importance, embedding, embedding_model, embedding_dim,
                        supersedes_id, derived_from_id, deleted_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        memory_map[memory.id],
                        space_id,
                        branch_map[memory.origin_branch_id],
                        commit_map[memory.source_commit_id],
                        memory.content,
                        memory.kind,
                        memory.importance,
                        (
                            base64.b64decode(memory.embedding)
                            if memory.embedding is not None
                            else None
                        ),
                        memory.embedding_model,
                        memory.embedding_dim,
                        (memory_map[memory.supersedes_id] if memory.supersedes_id else None),
                        (memory_map[memory.derived_from_id] if memory.derived_from_id else None),
                        memory.deleted_at,
                        memory.created_at,
                    ),
                )
            for override in payload.overrides:
                conn.execute(
                    """
                    INSERT INTO memory_overrides(
                        branch_id, memory_id, excluded, pinned, content_override, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        branch_map[override.branch_id],
                        memory_map[override.memory_id],
                        override.excluded,
                        override.pinned,
                        override.content_override,
                        override.updated_at,
                    ),
                )
            for proposal in payload.proposals:
                conn.execute(
                    """
                    INSERT INTO memory_proposals(
                        id, branch_id, commit_id, content, kind, importance,
                        conflicts_with_memory_id, reason, status, resolution,
                        accepted_memory_id, resolved_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        proposal_map[proposal.id],
                        branch_map[proposal.branch_id],
                        commit_map[proposal.commit_id],
                        proposal.content,
                        proposal.kind,
                        proposal.importance,
                        (
                            memory_map[proposal.conflicts_with_memory_id]
                            if proposal.conflicts_with_memory_id
                            else None
                        ),
                        proposal.reason,
                        proposal.status,
                        proposal.resolution,
                        (
                            memory_map[proposal.accepted_memory_id]
                            if proposal.accepted_memory_id
                            else None
                        ),
                        proposal.resolved_at,
                        proposal.created_at,
                    ),
                )
            for checkpoint in payload.checkpoints:
                conn.execute(
                    """
                    INSERT INTO checkpoints(
                        id, branch_id, commit_id, name, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        checkpoint_map[checkpoint.id],
                        branch_map[checkpoint.branch_id],
                        commit_map[checkpoint.commit_id],
                        checkpoint.name,
                        checkpoint.created_at,
                    ),
                )
    except sqlite3.IntegrityError as exc:
        raise ApiError(422, "invalid_import", "The import violates database constraints") from exc

    row = spaces_repo.require_owned(conn, space_id, owner_id)
    return ImportResultOut(
        space=SpaceOut(
            id=row["id"],
            name=row["name"],
            description=row["description"] or "",
            profile=payload.space.profile,
            created_at=row["created_at"],
        ),
        branch_count=len(payload.branches),
        commit_count=len(payload.commits),
        memory_count=len(payload.memories),
    )
