from __future__ import annotations

from fastapi import APIRouter, Response

from app.auth.deps import CurrentUser, DbConn
from app.models import BranchOut, SpaceCreate, SpaceOut, SpaceUpdate
from app.repo import branches as branches_repo
from app.repo import commits as commits_repo
from app.repo import spaces as spaces_repo
from app.visibility import effective_memories, visible_commit_chain

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
    result: list[BranchOut] = []
    for branch in branches_repo.list_for_space(conn, space_id):
        visible_ids = [row["id"] for row in visible_commit_chain(conn, branch)]
        result.append(
            BranchOut(
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
        )
    return result
