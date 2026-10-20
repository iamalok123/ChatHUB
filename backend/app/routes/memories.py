from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Request, Response

from app.auth.deps import CurrentUser, DbConn
from app.engine.classifiers import (
    detect_prompt_injection,
    detect_secret,
    detect_sensitivity,
    infer_subject_key,
)
from app.engine.memory_service import MemoryService
from app.errors import ApiError, not_found
from app.llm.base import LLMProvider
from app.llm.embeddings import to_blob
from app.models import (
    MemoryCreate,
    MemoryListOut,
    MemoryOut,
    MemoryOverrideRequest,
    MemoryUpdate,
    ProposalAcceptOut,
    ProposalAcceptRequest,
    ProposalOut,
)
from app.repo import branches as branches_repo
from app.repo import memories as memories_repo
from app.repo import proposals as proposals_repo
from app.viewmodels import memory_out, proposal_out
from app.visibility import (
    effective_memories,
    excluded_memories,
    visible_commit_ids,
)

logger = logging.getLogger("branchmind.memories")

router = APIRouter(tags=["memories"])


def _active_branch(conn: sqlite3.Connection, branch_id: str, owner_id: str) -> sqlite3.Row:
    branch = branches_repo.require_owned(conn, branch_id, owner_id)
    if branch["archived"]:
        raise ApiError(409, "branch_archived", "This branch is archived")
    return branch


def _visible_memory(conn: sqlite3.Connection, branch: sqlite3.Row, memory_id: str) -> sqlite3.Row:
    row = memories_repo.get(conn, memory_id)
    if row is None or row["space_id"] != branch["space_id"] or row["deleted_at"] is not None:
        raise not_found()
    if row["source_commit_id"] not in visible_commit_ids(conn, branch):
        raise not_found()
    return row


def _origin_names(conn: sqlite3.Connection, items: list[dict]) -> dict[str, str]:
    ids = {item.get("origin_branch_id") for item in items if item.get("origin_branch_id")}
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    return {
        row["id"]: row["name"]
        for row in conn.execute(
            f"SELECT id, name FROM branches WHERE id IN ({placeholders})",
            list(ids),
        ).fetchall()
    }


def _serialize(
    conn: sqlite3.Connection,
    branch: sqlite3.Row,
    provider: LLMProvider,
    item,
    *,
    excluded: bool = False,
) -> MemoryOut:
    data = dict(item)
    origin_id = data.get("origin_branch_id")
    data["inherited"] = origin_id != branch["id"]
    if not data.get("origin_branch_name"):
        names = _origin_names(conn, [data])
        data["origin_branch_name"] = names.get(origin_id, "unknown")
    if excluded:
        data["pinned"] = False
    return memory_out(data, provider=provider, excluded=excluded)


def _effective_item(conn: sqlite3.Connection, branch: sqlite3.Row, memory_id: str) -> dict | None:
    return next(
        (item for item in effective_memories(conn, branch) if item["id"] == memory_id),
        None,
    )


def _excluded_item(conn: sqlite3.Connection, branch: sqlite3.Row, memory_id: str) -> dict | None:
    return next(
        (item for item in excluded_memories(conn, branch) if item["id"] == memory_id),
        None,
    )


async def _embed(
    provider: LLMProvider, content: str
) -> tuple[bytes | None, str | None, int | None]:
    try:
        vectors = await provider.embed([content], task_type="RETRIEVAL_DOCUMENT")
    except Exception as exc:
        logger.warning("Memory embedding failed: %s", type(exc).__name__)
        return None, None, None
    if not vectors:
        return None, None, None
    return to_blob(vectors[0]), provider.embed_model, provider.embed_dim


@router.get("/branches/{branch_id}/memories", response_model=MemoryListOut)
def list_memories(
    branch_id: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MemoryListOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    provider = request.app.state.provider
    memories = [
        memory_out(
            item,
            provider=provider,
            origin_branch_name=item.get("origin_branch_name"),
        )
        for item in effective_memories(conn, branch)
    ]
    excluded_raw = excluded_memories(conn, branch)
    names = _origin_names(conn, excluded_raw)
    excluded = [
        memory_out(
            {**item, "origin_branch_name": names.get(item["origin_branch_id"], "unknown")},
            provider=provider,
            excluded=True,
        )
        for item in excluded_raw
    ]
    return MemoryListOut(memories=memories, excluded=excluded)


@router.post(
    "/branches/{branch_id}/memories",
    response_model=MemoryOut,
    status_code=201,
)
async def create_memory(
    branch_id: str,
    payload: MemoryCreate,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MemoryOut:
    branch = _active_branch(conn, branch_id, user.id)
    source_commit_id = branch["head_commit_id"]
    if not source_commit_id:
        raise ApiError(409, "branch_has_no_head", "The branch has no current head")

    secret_type = detect_secret(payload.content)
    if secret_type:
        raise ApiError(
            400,
            "secret_detected",
            f"Memory contains sensitive credentials: {secret_type}",
        )
    if detect_prompt_injection(payload.content):
        raise ApiError(
            400,
            "prompt_injection_detected",
            "Directives or imperative instructions cannot be saved as memories",
        )

    provider = request.app.state.provider
    embedding, model, dim = await _embed(provider, payload.content)
    sensitivity = detect_sensitivity(payload.content)
    subject_key = infer_subject_key(payload.content, payload.kind)
    row = memories_repo.create(
        conn,
        space_id=branch["space_id"],
        origin_branch_id=branch_id,
        source_commit_id=source_commit_id,
        content=payload.content,
        kind=payload.kind,
        importance=payload.importance,
        embedding=embedding,
        embedding_model=model,
        embedding_dim=dim,
        sensitivity=sensitivity,
        subject_key=subject_key,
    )
    return _serialize(conn, branch, provider, row)


@router.patch(
    "/branches/{branch_id}/memories/{memory_id}",
    response_model=MemoryOut,
)
async def update_memory(
    branch_id: str,
    memory_id: str,
    payload: MemoryUpdate,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MemoryOut:
    branch = _active_branch(conn, branch_id, user.id)
    row = _visible_memory(conn, branch, memory_id)
    if row["origin_branch_id"] != branch["id"]:
        raise ApiError(
            403,
            "inherited_memory",
            "Inherited memories can only be changed with branch overrides",
        )
    content = payload.content if payload.content is not None else row["content"]
    kind = payload.kind if payload.kind is not None else row["kind"]
    importance = payload.importance if payload.importance is not None else float(row["importance"])
    provider = request.app.state.provider
    if content != row["content"]:
        secret_type = detect_secret(content)
        if secret_type:
            raise ApiError(
                400,
                "secret_detected",
                f"Memory contains sensitive credentials: {secret_type}",
            )
        if detect_prompt_injection(content):
            raise ApiError(
                400,
                "prompt_injection_detected",
                "Directives or imperative instructions cannot be saved as memories",
            )
        embedding, model, dim = await _embed(provider, content)
        sensitivity = detect_sensitivity(content)
        subject_key = infer_subject_key(content, kind)
    else:
        embedding = row["embedding"]
        model = row["embedding_model"]
        dim = row["embedding_dim"]
        row_dict = dict(row)
        sensitivity = row_dict.get("sensitivity", "none")
        subject_key = row_dict.get("subject_key")
    updated = memories_repo.update(
        conn,
        memory_id,
        content=content,
        kind=kind,
        importance=importance,
        embedding=embedding,
        embedding_model=model,
        embedding_dim=dim,
        sensitivity=sensitivity,
        subject_key=subject_key,
    )
    item = _effective_item(conn, branch, memory_id) or dict(updated)
    return _serialize(conn, branch, provider, item)


@router.delete("/branches/{branch_id}/memories/{memory_id}", status_code=204)
def delete_memory(
    branch_id: str,
    memory_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> Response:
    branch = _active_branch(conn, branch_id, user.id)
    row = _visible_memory(conn, branch, memory_id)
    if row["origin_branch_id"] != branch["id"]:
        raise ApiError(
            403,
            "inherited_memory",
            "Inherited memories can only be excluded on this branch",
        )
    memories_repo.soft_delete(conn, memory_id)
    return Response(status_code=204)


@router.delete("/memories/{memory_id}/forget", status_code=204)
def forget_memory(
    memory_id: str,
    user: CurrentUser,
    conn: DbConn,
    propagate_derived: bool = False,
) -> Response:
    mem = memories_repo.get(conn, memory_id)
    if mem is None:
        raise not_found()
    space = conn.execute(
        "SELECT owner_id FROM spaces WHERE id = ?",
        (mem["space_id"],),
    ).fetchone()
    if space is None or space["owner_id"] != user.id:
        raise not_found()
    MemoryService.forget_memory(conn, memory_id, propagate_derived=propagate_derived)
    return Response(status_code=204)


@router.post(
    "/branches/{branch_id}/memories/{memory_id}/undo",
    response_model=MemoryOut,
)
def undo_memory(
    branch_id: str,
    memory_id: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MemoryOut:
    branch = _active_branch(conn, branch_id, user.id)
    row = _visible_memory(conn, branch, memory_id)
    if row["origin_branch_id"] != branch["id"]:
        raise ApiError(
            403,
            "inherited_memory",
            "Cannot undo modifications on inherited memory",
        )
    restored = MemoryService.undo_memory(conn, memory_id)
    provider = request.app.state.provider
    return _serialize(conn, branch, provider, restored)


@router.post(
    "/branches/{branch_id}/memories/{memory_id}/override",
    response_model=MemoryOut,
)
def override_memory(
    branch_id: str,
    memory_id: str,
    payload: MemoryOverrideRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MemoryOut:
    branch = _active_branch(conn, branch_id, user.id)
    _visible_memory(conn, branch, memory_id)
    provider = request.app.state.provider
    if payload.action == "exclude":
        item = _effective_item(conn, branch, memory_id)
        if item is None:
            excluded = _excluded_item(conn, branch, memory_id)
            if excluded is not None:
                return _serialize(conn, branch, provider, excluded, excluded=True)
            raise ApiError(409, "memory_not_effective", "This memory is no longer visible")
        memories_repo.set_override(conn, branch_id, memory_id, excluded=1)
        item = _excluded_item(conn, branch, memory_id)
        if item is None:
            raise not_found()
        return _serialize(conn, branch, provider, item, excluded=True)
    if payload.action == "include":
        memories_repo.set_override(conn, branch_id, memory_id, excluded=0)
        item = _effective_item(conn, branch, memory_id)
        if item is None:
            raise ApiError(409, "memory_not_effective", "Memory is still superseded")
        return _serialize(conn, branch, provider, item)
    if payload.action in {"pin", "unpin"}:
        item = _effective_item(conn, branch, memory_id)
        if item is None:
            raise ApiError(409, "memory_not_effective", "Excluded memories cannot be pinned")
        memories_repo.set_override(
            conn, branch_id, memory_id, pinned=1 if payload.action == "pin" else 0
        )
        item = _effective_item(conn, branch, memory_id)
        assert item is not None
        return _serialize(conn, branch, provider, item)
    if payload.content is None:
        raise ApiError(422, "invalid_request", "content is required for the edit action")
    if _effective_item(conn, branch, memory_id) is None:
        raise ApiError(409, "memory_not_effective", "Excluded memories cannot be edited")
    memories_repo.set_override(
        conn,
        branch_id,
        memory_id,
        content_override=payload.content,
        excluded=0,
    )
    item = _effective_item(conn, branch, memory_id)
    assert item is not None
    return _serialize(conn, branch, provider, item)


@router.get(
    "/branches/{branch_id}/proposals",
    response_model=list[ProposalOut],
)
def list_proposals(
    branch_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> list[ProposalOut]:
    branches_repo.require_owned(conn, branch_id, user.id)
    return [proposal_out(row) for row in proposals_repo.list_for_branch(conn, branch_id)]


@router.post(
    "/branches/{branch_id}/proposals/{proposal_id}/accept",
    response_model=ProposalAcceptOut,
)
async def accept_proposal(
    branch_id: str,
    proposal_id: str,
    payload: ProposalAcceptRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> ProposalAcceptOut:
    branch = _active_branch(conn, branch_id, user.id)
    proposal = proposals_repo.get(conn, proposal_id)
    if proposal is None or proposal["branch_id"] != branch_id:
        raise not_found()
    if proposal["status"] != "pending":
        raise ApiError(409, "proposal_resolved", "This proposal is already resolved")
    content = payload.content if payload.content is not None else proposal["content"]
    kind = payload.kind if payload.kind is not None else (proposal["kind"] or "fact")
    importance = (
        payload.importance
        if payload.importance is not None
        else float(proposal["importance"] if proposal["importance"] is not None else 0.5)
    )
    conflict_id = proposal["conflicts_with_memory_id"]
    if conflict_id and payload.resolution == "replace":
        supersedes_id = conflict_id
    elif conflict_id:
        supersedes_id = None
    elif payload.resolution == "replace":
        raise ApiError(422, "invalid_request", "replace requires a conflicting memory")
    else:
        supersedes_id = None

    provider = request.app.state.provider
    embedding, model, dim = await _embed(provider, content)
    with conn:
        row = memories_repo.create(
            conn,
            space_id=branch["space_id"],
            origin_branch_id=branch_id,
            source_commit_id=proposal["commit_id"],
            content=content,
            kind=kind,
            importance=importance,
            embedding=embedding,
            embedding_model=model,
            embedding_dim=dim,
            supersedes_id=supersedes_id,
            derived_from_id=None,
            commit=False,
        )
        updated = proposals_repo.resolve(
            conn,
            proposal_id,
            status="accepted",
            resolution=payload.resolution,
            accepted_memory_id=row["id"],
            commit=False,
        )
        if updated is None:
            raise ApiError(409, "proposal_resolved", "This proposal is already resolved")
    return ProposalAcceptOut(
        proposal=proposal_out(updated),
        memory=_serialize(conn, branch, provider, row),
    )


@router.post(
    "/branches/{branch_id}/proposals/{proposal_id}/reject",
    response_model=ProposalOut,
)
def reject_proposal(
    branch_id: str,
    proposal_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> ProposalOut:
    _active_branch(conn, branch_id, user.id)
    proposal = proposals_repo.get(conn, proposal_id)
    if proposal is None or proposal["branch_id"] != branch_id:
        raise not_found()
    if proposal["status"] != "pending":
        raise ApiError(409, "proposal_resolved", "This proposal is already resolved")
    updated = proposals_repo.resolve(
        conn,
        proposal_id,
        status="rejected",
        resolution="rejected",
    )
    if updated is None:
        raise ApiError(409, "proposal_resolved", "This proposal is already resolved")
    return proposal_out(updated)
