from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response

from app.auth.deps import CurrentUser, DbConn
from app.engine.jobs import contradiction_sweep, staleness_sweep
from app.models import (
    BranchOut,
    GraphCheckpointOut,
    GraphEdgeOut,
    SpaceCreate,
    SpaceGraphOut,
    SpaceOut,
    SpaceUpdate,
)
from app.ops.demo import seed_demo_space
from app.repo import branches as branches_repo
from app.repo import checkpoints as checkpoints_repo
from app.repo import commits as commits_repo
from app.repo import spaces as spaces_repo
from app.viewmodels import branch_out

router = APIRouter(tags=["spaces"])


@router.get("/spaces", response_model=list[SpaceOut])
def list_spaces(user: CurrentUser, conn: DbConn) -> list[SpaceOut]:
    return [SpaceOut(**spaces_repo.to_dict(row)) for row in spaces_repo.list_owned(conn, user.id)]


@router.post("/spaces", response_model=SpaceOut, status_code=201)
def create_space(
    payload: SpaceCreate,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceOut:
    space, _branch = spaces_repo.create_with_main(
        conn, user.id, payload.name, payload.description, payload.profile
    )
    return SpaceOut(**spaces_repo.to_dict(space))


@router.post("/demo-space", response_model=SpaceOut, status_code=201)
async def create_demo_space(
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceOut:
    row = await seed_demo_space(conn, request.app.state.provider, user.id)
    return SpaceOut(**spaces_repo.to_dict(row))


@router.get("/spaces/{space_id}", response_model=SpaceOut)
def get_space(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceOut:
    row = spaces_repo.require_owned(conn, space_id, user.id)
    return SpaceOut(**spaces_repo.to_dict(row))


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
def update_space(
    space_id: str,
    payload: SpaceUpdate,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceOut:
    row = spaces_repo.update(
        conn,
        space_id,
        user.id,
        name=payload.name,
        description=payload.description,
        profile=payload.profile,
    )
    return SpaceOut(**spaces_repo.to_dict(row))


@router.delete("/spaces/{space_id}", status_code=204)
def delete_space(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> Response:
    spaces_repo.delete(conn, space_id, user.id)
    return Response(status_code=204)


@router.get("/spaces/{space_id}/branches", response_model=list[BranchOut])
def list_branches(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> list[BranchOut]:
    spaces_repo.require_owned(conn, space_id, user.id)
    return [branch_out(conn, branch) for branch in branches_repo.list_for_space(conn, space_id)]


@router.get("/spaces/{space_id}/graph", response_model=SpaceGraphOut)
def space_graph(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> SpaceGraphOut:
    spaces_repo.require_owned(conn, space_id, user.id)
    branch_rows = branches_repo.list_for_space(conn, space_id)
    branch_ids = {row["id"] for row in branch_rows}

    edges: list[GraphEdgeOut] = []
    for branch in branch_rows:
        if branch["parent_branch_id"] is None or branch["fork_commit_id"] is None:
            continue
        edges.append(
            GraphEdgeOut(
                id=f"fork:{branch['id']}",
                source_branch_id=branch["parent_branch_id"],
                target_branch_id=branch["id"],
                kind="fork",
                commit_id=branch["fork_commit_id"],
                created_at=branch["created_at"],
            )
        )
    for event in commits_repo.list_events_for_space(conn, space_id):
        source_id = event["source_branch_id"]
        if source_id not in branch_ids or event["branch_id"] not in branch_ids:
            continue
        edges.append(
            GraphEdgeOut(
                id=f"{event['role']}:{event['id']}",
                source_branch_id=source_id,
                target_branch_id=event["branch_id"],
                kind=event["role"],
                commit_id=event["id"],
                created_at=event["created_at"],
            )
        )

    return SpaceGraphOut(
        branches=[branch_out(conn, branch) for branch in branch_rows],
        edges=edges,
        checkpoints=[
            GraphCheckpointOut(
                id=row["id"],
                branch_id=row["branch_id"],
                commit_id=row["commit_id"],
                name=row["name"],
                created_at=row["created_at"],
            )
            for row in checkpoints_repo.list_for_space(conn, space_id)
        ],
    )


@router.post("/spaces/{space_id}/maintenance/staleness-sweep")
def run_space_staleness_sweep(
    space_id: str,
    payload: dict[str, Any] | None,
    user: CurrentUser,
    conn: DbConn,
) -> dict[str, Any]:
    spaces_repo.require_owned(conn, space_id, user.id)
    expired_id = payload.get("expired_memory_id") if payload else None
    return staleness_sweep(conn, space_id, expired_id)


@router.get("/spaces/{space_id}/maintenance/contradictions")
def run_space_contradiction_sweep(
    space_id: str,
    user: CurrentUser,
    conn: DbConn,
) -> dict[str, Any]:
    spaces_repo.require_owned(conn, space_id, user.id)
    contradictions = contradiction_sweep(conn, space_id)
    return {"contradictions": contradictions}
