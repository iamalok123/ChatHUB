from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Request

from app.auth.deps import CurrentUser, DbConn
from app.errors import ApiError, not_found
from app.models import (
    BranchOut,
    CheckpointCreate,
    CheckpointOut,
    DiffOut,
    ForkPreviewOut,
    ForkRequest,
    ImportResultOut,
    MergePreviewOut,
    MergeRequest,
    MergeResultOut,
    MergeSummaryOut,
    MergeSummaryRequest,
    SpaceExport,
    SyncPreviewOut,
    SyncRequest,
    SyncResultOut,
)
from app.ops.diff import compute_diff
from app.ops.export import export_space, import_space
from app.ops.fork import create_fork, preview_fork
from app.ops.merge import (
    generate_merge_summary,
    load_merge_target,
    merge_memories,
    preview_merge,
)
from app.ops.sync import load_parent, preview_sync, sync_memories
from app.repo import branches as branches_repo
from app.repo import checkpoints as checkpoints_repo
from app.repo import spaces as spaces_repo
from app.viewmodels import branch_out
from app.visibility import require_visible_commit

router = APIRouter(tags=["operations"])


def _preview(role: str, content: str) -> str:
    text = " ".join((content or "").split())
    return "Branch start" if role == "anchor" else text[:160]


def _checkpoint_out(row: sqlite3.Row) -> CheckpointOut:
    return CheckpointOut(
        id=row["id"],
        branch_id=row["branch_id"],
        commit_id=row["commit_id"],
        name=row["name"],
        commit_role=row["commit_role"],
        preview=_preview(row["commit_role"], row["commit_content"] or ""),
        created_at=row["created_at"],
    )


@router.get("/branches/{branch_id}/fork-preview", response_model=ForkPreviewOut)
def fork_preview(
    branch_id: str,
    commit_id: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> ForkPreviewOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    return preview_fork(conn, request.app.state.provider, branch, commit_id)


@router.post("/branches/{branch_id}/fork", response_model=BranchOut, status_code=201)
def fork_branch(
    branch_id: str,
    payload: ForkRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> BranchOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    commit_id = payload.commit_id or branch["head_commit_id"]
    if commit_id is None:
        raise not_found()
    child = create_fork(
        conn,
        source=branch,
        commit_id=commit_id,
        payload=payload,
        settings=request.app.state.settings,
    )
    return branch_out(conn, child)


@router.get("/branches/{branch_id}/merge-preview", response_model=MergePreviewOut)
async def merge_preview(
    branch_id: str,
    target: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MergePreviewOut:
    source = branches_repo.require_owned(conn, branch_id, user.id)
    resolved_target = load_merge_target(conn, source, target, user.id)
    return await preview_merge(conn, request.app.state.provider, source, resolved_target)


@router.post("/branches/{branch_id}/merge", response_model=MergeResultOut)
async def merge(
    branch_id: str,
    payload: MergeRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MergeResultOut:
    source = branches_repo.require_owned(conn, branch_id, user.id)
    resolved_target = load_merge_target(conn, source, payload.target_branch_id, user.id)
    return await merge_memories(
        conn,
        request.app.state.provider,
        source,
        resolved_target,
        payload,
    )


@router.post("/branches/{branch_id}/merge-summary", response_model=MergeSummaryOut)
async def merge_summary(
    branch_id: str,
    payload: MergeSummaryRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> MergeSummaryOut:
    source = branches_repo.require_owned(conn, branch_id, user.id)
    resolved_target = load_merge_target(conn, source, payload.target_branch_id, user.id)
    return await generate_merge_summary(
        conn,
        request.app.state.provider,
        source,
        resolved_target,
        payload.memory_ids,
    )


@router.get("/branches/{branch_id}/sync-preview", response_model=SyncPreviewOut)
async def sync_preview(
    branch_id: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> SyncPreviewOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    parent = load_parent(conn, branch, user.id)
    return await preview_sync(conn, request.app.state.provider, branch, parent)


@router.post("/branches/{branch_id}/sync", response_model=SyncResultOut)
async def sync(
    branch_id: str,
    payload: SyncRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> SyncResultOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    parent = load_parent(conn, branch, user.id)
    return await sync_memories(conn, request.app.state.provider, branch, parent, payload)


@router.get("/branches/{branch_id}/diff", response_model=DiffOut)
def diff(
    branch_id: str,
    against: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> DiffOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    against_branch = branches_repo.require_owned(conn, against, user.id)
    return compute_diff(conn, request.app.state.provider, branch, against_branch)


@router.get("/branches/{branch_id}/checkpoints", response_model=list[CheckpointOut])
def list_checkpoints(
    branch_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> list[CheckpointOut]:
    branches_repo.require_owned(conn, branch_id, user.id)
    return [_checkpoint_out(row) for row in checkpoints_repo.list_for_branch(conn, branch_id)]


@router.post(
    "/branches/{branch_id}/checkpoints",
    response_model=CheckpointOut,
    status_code=201,
)
def create_checkpoint(
    branch_id: str,
    payload: CheckpointCreate,
    user: CurrentUser,
    conn: DbConn,
) -> CheckpointOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    if branch["archived"]:
        raise ApiError(409, "branch_archived", "Archived branches cannot be checkpointed")
    commit_id = payload.commit_id or branch["head_commit_id"]
    if commit_id is None:
        raise not_found()
    commit = require_visible_commit(conn, branch, commit_id)
    row = checkpoints_repo.create(
        conn,
        branch_id=branch_id,
        commit_id=commit["id"],
        name=payload.name,
    )
    return _checkpoint_out(row)


@router.post(
    "/branches/{branch_id}/checkpoints/{checkpoint_id}/fork",
    response_model=BranchOut,
    status_code=201,
)
def fork_checkpoint(
    branch_id: str,
    checkpoint_id: str,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
    payload: ForkRequest | None = None,
) -> BranchOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    checkpoint = checkpoints_repo.get(conn, checkpoint_id)
    if checkpoint is None or checkpoint["branch_id"] != branch_id:
        raise not_found()
    require_visible_commit(conn, branch, checkpoint["commit_id"])
    body = payload or ForkRequest()
    if body.name is None:
        body = body.model_copy(update={"name": checkpoint["name"]})
    child = create_fork(
        conn,
        source=branch,
        commit_id=checkpoint["commit_id"],
        payload=body,
        settings=request.app.state.settings,
    )
    return branch_out(conn, child)


@router.get("/spaces/{space_id}/export", response_model=SpaceExport)
def export_space_route(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceExport:
    space = spaces_repo.require_owned(conn, space_id, user.id)
    return export_space(conn, space)


@router.post("/spaces/import", response_model=ImportResultOut, status_code=201)
def import_space_route(
    payload: SpaceExport,
    user: CurrentUser,
    conn: DbConn,
) -> ImportResultOut:
    return import_space(conn, user.id, payload)
