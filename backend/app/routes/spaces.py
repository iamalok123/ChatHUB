from __future__ import annotations

from fastapi import APIRouter, Response

from app.auth.deps import CurrentUser, DbConn
from app.models import BranchOut, SpaceCreate, SpaceOut, SpaceUpdate
from app.repo import branches as branches_repo
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
    return [
        branch_out(conn, branch)
        for branch in branches_repo.list_for_space(conn, space_id)
    ]
