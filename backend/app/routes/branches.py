from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.auth.deps import CurrentUser, DbConn
from app.errors import ApiError, not_found
from app.models import BranchOut, BranchUpdate, MessageOut, TraceOut
from app.repo import branches as branches_repo
from app.viewmodels import branch_out, message_out, parse_trace
from app.visibility import require_visible_commit, visible_messages

router = APIRouter(tags=["branches"])

NON_NULLABLE_FIELDS = {"name", "thinking_level", "top_k", "memory_mode", "archived"}


@router.get("/branches/{branch_id}", response_model=BranchOut)
def get_branch(
    branch_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> BranchOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    return branch_out(conn, branch)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(
    branch_id: str,
    payload: BranchUpdate,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> BranchOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    values = payload.model_dump(exclude_unset=True)
    for key in NON_NULLABLE_FIELDS:
        if key in values and values[key] is None:
            raise ApiError(
                422, "invalid_request", f"{key} cannot be null"
            )
    if "archived" in values and branch["parent_branch_id"] is None:
        raise ApiError(
            409, "root_branch_protected", "The root branch cannot be archived"
        )
    model = values.get("model")
    if model is not None and model not in request.app.state.settings.gemini_allowed_models:
        raise ApiError(
            422,
            "invalid_request",
            "model is not in GEMINI_ALLOWED_MODELS",
        )
    row = branches_repo.update_settings(conn, branch_id, user.id, values)
    return branch_out(conn, row)


@router.delete("/branches/{branch_id}", status_code=204)
def delete_branch(
    branch_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> Response:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    if branch["parent_branch_id"] is None:
        raise ApiError(
            409, "root_branch_protected", "The root branch cannot be removed"
        )
    if branches_repo.has_children(conn, branch_id):
        branches_repo.archive(conn, branch_id)
    else:
        branches_repo.delete(conn, branch_id)
    return Response(status_code=204)


@router.get("/branches/{branch_id}/messages", response_model=list[MessageOut])
def list_messages(
    branch_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> list[MessageOut]:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    return [
        message_out(conn, branch, commit)
        for commit in visible_messages(conn, branch)
    ]


@router.get(
    "/branches/{branch_id}/messages/{commit_id}/trace",
    response_model=TraceOut,
)
def get_trace(
    branch_id: str,
    commit_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> TraceOut:
    branch = branches_repo.require_owned(conn, branch_id, user.id)
    commit = require_visible_commit(conn, branch, commit_id)
    if commit["role"] != "assistant":
        raise not_found()
    trace, version = parse_trace(commit["trace_json"])
    if trace is None:
        raise not_found("trace_not_found", "No trace is stored for this message")
    return TraceOut(
        commit_id=commit_id,
        branch_id=branch_id,
        trace=trace,
        trace_version=version,
    )
