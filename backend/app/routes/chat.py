from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.auth.deps import CurrentUser
from app.engine.chat import ChatStreamer
from app.engine.context import ComposedContext, compose_context
from app.engine.extraction import MemoryExtractor
from app.engine.retrieval import RetrievalResult, retrieve_memories
from app.errors import ApiError, not_found
from app.models import ChatRequest
from app.repo import branches as branches_repo
from app.repo import commits as commits_repo
from app.repo import spaces as spaces_repo
from app.visibility import require_visible_commit, visible_messages

router = APIRouter(tags=["chat"])

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}


def _active_branch(
    conn: sqlite3.Connection, branch_id: str, user_id: str
) -> tuple[sqlite3.Row, sqlite3.Row]:
    branch = branches_repo.require_owned(conn, branch_id, user_id)
    space = spaces_repo.require_owned(conn, branch["space_id"], user_id)
    if branch["archived"]:
        raise ApiError(409, "branch_archived", "This branch is archived")
    return branch, space


def _compose(
    *,
    request: Request,
    branch: sqlite3.Row,
    space: sqlite3.Row,
    history: list[sqlite3.Row],
    current_user_text: str,
    retrieval: RetrievalResult,
) -> tuple[ComposedContext, dict[str, object]]:
    settings = request.app.state.settings
    started = time.perf_counter()
    context = compose_context(
        space=space,
        branch=branch,
        history=history,
        current_user_text=current_user_text,
        memories=retrieval.selected,
        history_budget=settings.history_token_budget,
        memory_budget=settings.memory_token_budget,
    )
    compose_ms = int((time.perf_counter() - started) * 1000)
    return context, {
        "phase": "compose",
        "status": "done",
        "duration_ms": compose_ms,
        "payload": context.stats,
    }


def _previous_assistant(history: list[sqlite3.Row]) -> str | None:
    for row in reversed(history):
        if row["role"] == "assistant" and (row["content"] or "").strip():
            return row["content"]
    return None


def _retrieval_trace(retrieval: RetrievalResult) -> dict[str, object]:
    return {
        "query": retrieval.query,
        "query_tokens": retrieval.query_tokens,
        "used_tokens": retrieval.used_tokens,
        "top_k": retrieval.top_k,
        "duration_ms": retrieval.duration_ms,
        "selected": retrieval.selected_details,
        "considered": retrieval.considered,
        "excluded": retrieval.excluded,
        "warnings": retrieval.warnings,
    }


def _stream(
    *,
    request: Request,
    branch: sqlite3.Row,
    space: sqlite3.Row,
    context: ComposedContext,
    steps: list[dict[str, object]],
    assistant_commit_id: str,
    current_user_commit_id: str | None,
    current_user_text: str,
    retrieval: RetrievalResult,
    regenerated_from: str | None = None,
    branch_event: dict[str, str] | None = None,
) -> StreamingResponse:
    streamer = ChatStreamer(
        database=request.app.state.database,
        provider=request.app.state.provider,
        settings=request.app.state.settings,
        branch=branch,
        space=space,
        context=context,
        assistant_commit_id=assistant_commit_id,
        current_user_commit_id=current_user_commit_id,
        initial_steps=steps,
        regenerated_from=regenerated_from,
        branch_event=branch_event,
        retrieval=_retrieval_trace(retrieval),
        current_user_text=current_user_text,
        extractor=MemoryExtractor(
            request.app.state.database,
            request.app.state.provider,
            request.app.state.settings,
        ),
    )
    return StreamingResponse(
        streamer.stream(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/branches/{branch_id}/chat")
async def chat(
    branch_id: str,
    payload: ChatRequest,
    request: Request,
    user: CurrentUser,
) -> StreamingResponse:
    conn = request.app.state.database.connect()
    try:
        branch, space = _active_branch(conn, branch_id, user.id)
        current_head = branch["head_commit_id"]
        if payload.expected_head_id is not None and payload.expected_head_id != current_head:
            raise ApiError(
                409,
                "head_conflict",
                "The branch changed since you loaded it. Refresh and try again.",
            )
        history = visible_messages(conn, branch)
        try:
            user_commit = commits_repo.append_at_head(
                conn,
                space_id=branch["space_id"],
                branch_id=branch_id,
                expected_head_id=current_head,
                role="user",
                content=payload.message,
            )
        except commits_repo.HeadConflict as exc:
            raise ApiError(
                409,
                "head_conflict",
                "The branch changed while sending. Refresh and try again.",
            ) from exc
        provider = request.app.state.provider
        settings = request.app.state.settings
        qdrant = getattr(request.app.state, "qdrant", None)
        retrieval = await retrieve_memories(
            conn,
            branch,
            user_text=payload.message,
            previous_assistant_text=_previous_assistant(history),
            provider=provider,
            top_k=branch["top_k"],
            memory_budget=settings.memory_token_budget,
            qdrant=qdrant,
        )
        context, compose_step = _compose(
            request=request,
            branch=branch,
            space=space,
            history=history,
            current_user_text=payload.message,
            retrieval=retrieval,
        )
        steps: list[dict[str, object]] = [
            {
                "phase": "retrieve",
                "status": "done",
                "duration_ms": retrieval.duration_ms,
                "payload": retrieval.step_payload(),
            },
            compose_step,
        ]
        try:
            assistant_commit = commits_repo.append_at_head(
                conn,
                space_id=branch["space_id"],
                branch_id=branch_id,
                expected_head_id=user_commit["id"],
                role="assistant",
                content="",
                status="streaming",
            )
        except commits_repo.HeadConflict as exc:
            raise ApiError(
                409,
                "head_conflict",
                "The branch changed while sending. Refresh and try again.",
            ) from exc
    finally:
        conn.close()

    return _stream(
        request=request,
        branch=branch,
        space=space,
        context=context,
        steps=steps,
        assistant_commit_id=assistant_commit["id"],
        current_user_commit_id=user_commit["id"],
        current_user_text=payload.message,
        retrieval=retrieval,
    )


@router.post("/branches/{branch_id}/regenerate/{commit_id}")
async def regenerate(
    branch_id: str,
    commit_id: str,
    request: Request,
    user: CurrentUser,
) -> StreamingResponse:
    conn = request.app.state.database.connect()
    try:
        branch, _space = _active_branch(conn, branch_id, user.id)
        target = require_visible_commit(conn, branch, commit_id)
        if target["role"] != "assistant" or not target["parent_id"]:
            raise ApiError(422, "invalid_target", "Only an assistant message can be regenerated")
        parent = visible_parent(conn, branch, target)
        source = branches_repo.require_owned(conn, target["branch_id"], user.id)
        if source["archived"]:
            raise ApiError(409, "branch_archived", "This branch is archived")
        space = spaces_repo.require_owned(conn, branch["space_id"], user.id)

        name = branches_repo.unique_name(conn, branch["space_id"], f"{source['name']} (retry)")
        new_branch, _anchor = branches_repo.create(
            conn,
            space_id=branch["space_id"],
            name=name,
            parent_branch_id=source["id"],
            fork_commit_id=parent["id"],
            system_prompt=source["system_prompt"] or "",
            persona=source["persona"] or "",
            model=source["model"],
            thinking_level=source["thinking_level"],
            top_k=source["top_k"],
            memory_mode=source["memory_mode"],
        )
        history = visible_messages(conn, new_branch)
        if not history or history[-1]["id"] != parent["id"]:
            raise ApiError(
                409,
                "invalid_fork_point",
                "The message before this reply is no longer visible",
            )
        history_before_current = history[:-1]
        provider = request.app.state.provider
        settings = request.app.state.settings
        qdrant = getattr(request.app.state, "qdrant", None)
        retrieval = await retrieve_memories(
            conn,
            new_branch,
            user_text=parent["content"],
            previous_assistant_text=_previous_assistant(history_before_current),
            provider=provider,
            top_k=new_branch["top_k"],
            memory_budget=settings.memory_token_budget,
            qdrant=qdrant,
        )
        context, compose_step = _compose(
            request=request,
            branch=new_branch,
            space=space,
            history=history_before_current,
            current_user_text=parent["content"],
            retrieval=retrieval,
        )
        steps: list[dict[str, object]] = [
            {
                "phase": "retrieve",
                "status": "done",
                "duration_ms": retrieval.duration_ms,
                "payload": retrieval.step_payload(),
            },
            compose_step,
        ]
        assistant_commit = commits_repo.append_at_head(
            conn,
            space_id=branch["space_id"],
            branch_id=new_branch["id"],
            expected_head_id=new_branch["head_commit_id"],
            role="assistant",
            content="",
            status="streaming",
        )
    finally:
        conn.close()

    return _stream(
        request=request,
        branch=new_branch,
        space=space,
        context=context,
        steps=steps,
        assistant_commit_id=assistant_commit["id"],
        current_user_commit_id=parent["id"],
        current_user_text=parent["content"],
        retrieval=retrieval,
        regenerated_from=target["id"],
        branch_event={
            "branch_id": new_branch["id"],
            "name": new_branch["name"],
            "parent_branch_id": source["id"],
            "fork_commit_id": parent["id"],
        },
    )


def visible_parent(
    conn: sqlite3.Connection, branch: sqlite3.Row, target: sqlite3.Row
) -> sqlite3.Row:
    parent = commits_repo.get(conn, target["parent_id"])
    if (
        parent is None
        or parent["role"] != "user"
        or parent["id"] not in {row["id"] for row in visible_messages(conn, branch)}
    ):
        raise not_found()
    return parent
