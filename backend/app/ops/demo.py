from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

import numpy as np

from app.engine.context import build_system_instruction, estimate_tokens
from app.llm.base import LLMProvider
from app.llm.embeddings import cosine, from_blob, is_stale_embedding, to_blob
from app.repo import branches as branches_repo
from app.repo import checkpoints as checkpoints_repo
from app.repo import commits as commits_repo
from app.repo import memories as memories_repo
from app.repo import proposals as proposals_repo
from app.repo import spaces as spaces_repo
from app.visibility import (
    effective_memories,
    excluded_memories,
    visible_commit_ids,
    visible_messages,
)

DEMO_NAME = "Leafmark demo"
DEMO_MODEL = "seeded-demo"
DEMO_SUMMARY = (
    "Seeded demo transcript. No live model call produced this reply. "
    "The context, retrieved memories, and scores below were assembled locally to "
    "show how BranchMind explains an answer."
)

MAIN_MEMORIES = (
    (
        "The user is building a reading-list app called Leafmark.",
        "fact",
        0.86,
    ),
    (
        "The user prefers short answers with concrete TypeScript examples.",
        "preference",
        0.94,
    ),
    (
        "The stack should stay simple: React, TypeScript, and local storage.",
        "decision",
        0.82,
    ),
    (
        "Saved articles need tags and a read-later status.",
        "task",
        0.68,
    ),
)
INDEXEDDB_MEMORY = (
    "The user wants IndexedDB examples for offline reading.",
    "task",
    0.72,
)
UI_PROPOSAL = (
    "The user wants a minimal reading view with generous whitespace.",
    "preference",
    0.74,
)


def _append(conn: sqlite3.Connection, branch: sqlite3.Row, role: str, content: str) -> sqlite3.Row:
    current = conn.execute(
        "SELECT head_commit_id FROM branches WHERE id = ?", (branch["id"],)
    ).fetchone()
    assert current is not None
    return commits_repo.create(
        conn,
        space_id=branch["space_id"],
        branch_id=branch["id"],
        role=role,
        content=content,
        parent_id=current["head_commit_id"],
    )


async def _memory_vectors(provider: LLMProvider, contents: list[str]) -> dict[str, list[float]]:
    if not contents:
        return {}
    try:
        vectors = await provider.embed(contents, task_type="RETRIEVAL_DOCUMENT")
    except Exception:
        return {}
    if len(vectors) != len(contents):
        return {}
    return dict(zip(contents, vectors, strict=True))


async def _query_vectors(provider: LLMProvider, queries: list[str]) -> dict[str, list[float]]:
    if not queries:
        return {}
    try:
        vectors = await provider.embed(queries, task_type="RETRIEVAL_QUERY")
    except Exception:
        return {}
    if len(vectors) != len(queries):
        return {}
    return dict(zip(queries, vectors, strict=True))


def _add_memory(
    conn: sqlite3.Connection,
    *,
    branch: sqlite3.Row,
    source_commit_id: str,
    spec: tuple[str, str, float],
    vectors: dict[str, list[float]],
    provider: LLMProvider,
) -> sqlite3.Row:
    content, kind, importance = spec
    vector = vectors.get(content)
    return memories_repo.create(
        conn,
        space_id=branch["space_id"],
        origin_branch_id=branch["id"],
        source_commit_id=source_commit_id,
        content=content,
        kind=kind,
        importance=importance,
        embedding=to_blob(vector) if vector is not None else None,
        embedding_model=provider.embed_model if vector is not None else None,
        embedding_dim=provider.embed_dim if vector is not None else None,
    )


def _exchange(
    conn: sqlite3.Connection,
    *,
    branch: sqlite3.Row,
    user_text: str,
    assistant_text: str,
    memory_specs: tuple[tuple[str, str, float], ...] = (),
    vectors: dict[str, list[float]],
    provider: LLMProvider,
) -> tuple[sqlite3.Row, sqlite3.Row]:
    user = _append(conn, branch, "user", user_text)
    assistant = _append(conn, branch, "assistant", assistant_text)
    for spec in memory_specs:
        _add_memory(
            conn,
            branch=branch,
            source_commit_id=user["id"],
            spec=spec,
            vectors=vectors,
            provider=provider,
        )
    return user, assistant


def _days_old(created_at: str) -> float:
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0.0
    delta = (datetime.now(UTC) - created).total_seconds() / 86400
    return max(0.0, delta)


def _recency(created_at: str) -> float:
    return float(0.5 ** (_days_old(created_at) / 30.0))


def _vector(item: dict[str, Any], provider: LLMProvider) -> np.ndarray | None:
    blob = item.get("embedding")
    if blob is None or is_stale_embedding(
        item.get("embedding_model"),
        item.get("embedding_dim"),
        provider.embed_model,
        provider.embed_dim,
    ):
        return None
    try:
        vector = from_blob(blob)
    except (TypeError, ValueError):
        return None
    return vector if vector.size == provider.embed_dim else None


def _trace_memory(
    item: dict[str, Any],
    *,
    similarity: float | None,
    score: float | None,
    reason: str,
) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "content": item.get("content", ""),
        "kind": item.get("kind", "fact"),
        "importance": round(float(item.get("importance", 0.5)), 4),
        "pinned": bool(item.get("pinned", False)),
        "edited": bool(item.get("edited", False)),
        "inherited": bool(item.get("inherited", False)),
        "origin_branch_name": item.get("origin_branch_name", "unknown"),
        "source_commit_id": item.get("source_commit_id"),
        "similarity": None if similarity is None else round(similarity, 4),
        "importance_score": round(float(item.get("importance", 0.5)), 4),
        "recency": round(_recency(item.get("created_at", "")), 4),
        "score": None if score is None else round(score, 4),
        "reason": reason,
        "tokens": estimate_tokens(str(item.get("content", ""))),
    }


def _excluded_for(
    conn: sqlite3.Connection, branch: sqlite3.Row, head_override: str
) -> list[dict[str, Any]]:
    visible = visible_commit_ids(conn, branch, head_override)
    items: list[dict[str, Any]] = []
    for item in excluded_memories(conn, branch):
        if item.get("source_commit_id") not in visible:
            continue
        origin = conn.execute(
            "SELECT name FROM branches WHERE id = ?", (item.get("origin_branch_id"),)
        ).fetchone()
        item["origin_branch_name"] = origin["name"] if origin else "unknown"
        item["pinned"] = False
        item["edited"] = False
        item["inherited"] = item.get("origin_branch_id") != branch["id"]
        items.append(item)
    return items


def _build_trace(
    conn: sqlite3.Connection,
    *,
    provider: LLMProvider,
    space: sqlite3.Row,
    branch: sqlite3.Row,
    assistant: sqlite3.Row,
    query: str,
    query_vector: np.ndarray | None,
) -> dict[str, Any]:
    memories = effective_memories(conn, branch, head_override=assistant["id"])
    ranked: list[tuple[float, dict[str, Any], float | None]] = []
    for item in memories:
        vector = _vector(item, provider)
        similarity = (
            cosine(query_vector, vector)
            if query_vector is not None and vector is not None
            else None
        )
        if similarity is None:
            score = (
                float(item.get("importance", 0.5)) * 0.25
                + _recency(item.get("created_at", "")) * 0.15
            )
        else:
            score = (
                0.60 * similarity
                + 0.25 * float(item.get("importance", 0.5))
                + 0.15 * _recency(item.get("created_at", ""))
            )
        ranked.append((score, item, similarity))
    ranked.sort(key=lambda entry: (not bool(entry[1].get("pinned")), -entry[0]))
    top_k = max(1, int(branch["top_k"]))
    selected = ranked[:top_k]
    considered = ranked[top_k:]

    selected_details: list[dict[str, Any]] = []
    for score, item, similarity in selected:
        if item.get("pinned"):
            reason = "pinned"
        elif similarity is None:
            reason = "stale embedding"
        elif similarity >= 0.75:
            reason = f"high similarity {similarity:.2f}"
        else:
            reason = f"selected score {score:.2f}"
        selected_details.append(
            _trace_memory(item, similarity=similarity, score=score, reason=reason)
        )

    considered_details = [
        _trace_memory(item, similarity=similarity, score=score, reason="below top-k")
        for score, item, similarity in considered
    ]
    excluded_details = [
        _trace_memory(
            item,
            similarity=None,
            score=None,
            reason="excluded on this branch",
        )
        for item in _excluded_for(conn, branch, assistant["id"])
    ]

    chain = visible_messages(conn, branch, head_override=assistant["id"])
    parent_index = next(
        (index for index, row in enumerate(chain) if row["id"] == assistant["parent_id"]),
        max(0, len(chain) - 1),
    )
    history = chain[:parent_index]
    current_tokens = estimate_tokens(query)
    history_tokens = sum(estimate_tokens(row["content"]) for row in history)
    memory_tokens = sum(item["tokens"] for item in selected_details)
    system_instruction = build_system_instruction(space=space, branch=branch, memories=memories)
    system_tokens = estimate_tokens(system_instruction)
    used_tokens = sum(item["tokens"] for item in selected_details)
    generate_ms = 1800 + len(selected_details) * 180
    usage = {
        "prompt_token_count": system_tokens + memory_tokens + history_tokens + current_tokens,
        "candidates_token_count": estimate_tokens(assistant["content"]),
        "total_token_count": (
            system_tokens
            + memory_tokens
            + history_tokens
            + current_tokens
            + estimate_tokens(assistant["content"])
        ),
    }

    return {
        "version": 1,
        "provider": "demo",
        "mock": False,
        "demo": True,
        "model": DEMO_MODEL,
        "thinking_level": branch["thinking_level"],
        "thinking_summary": DEMO_SUMMARY,
        "thinking_source": "synthetic_context",
        "context": {
            "system_tokens": system_tokens,
            "memory_tokens": memory_tokens,
            "history_tokens": history_tokens,
            "current_tokens": current_tokens,
            "total_tokens": (system_tokens + memory_tokens + history_tokens + current_tokens),
            "history_messages": len(history),
            "dropped_turns": 0,
            "memory_count": len(selected_details),
        },
        "memory_mode": branch["memory_mode"],
        "retrieval": {
            "query": query,
            "query_tokens": current_tokens,
            "used_tokens": used_tokens,
            "top_k": top_k,
            "duration_ms": 18,
        },
        "retrieved_memories": selected_details,
        "considered_memories": considered_details,
        "excluded_memories": excluded_details,
        "memory_operations": [],
        "warnings": (
            []
            if query_vector is not None
            else ["Seeded without embeddings; similarity scores are unavailable."]
        ),
        "usage": usage,
        "finish_reason": "DEMO",
        "steps": [
            {
                "phase": "retrieve",
                "status": "done",
                "duration_ms": 18,
                "payload": {
                    "selected": len(selected_details),
                    "considered": len(considered_details),
                    "excluded": len(excluded_details),
                },
            },
            {
                "phase": "compose",
                "status": "done",
                "duration_ms": 4,
                "payload": {"tokens": system_tokens + memory_tokens + history_tokens},
            },
            {
                "phase": "generate",
                "status": "done",
                "duration_ms": generate_ms,
                "payload": {"provider": "demo", "model": DEMO_MODEL},
            },
        ],
        "error": None,
        "error_code": None,
        "regenerated_from": None,
        "current_user_commit_id": assistant["parent_id"],
        "status": "complete",
        "duration_ms": generate_ms,
        "generate_ms": generate_ms,
        "completed_at": assistant["created_at"],
    }


def _seed_traces(
    conn: sqlite3.Connection,
    *,
    provider: LLMProvider,
    space: sqlite3.Row,
    branch_rows: list[sqlite3.Row],
    queries: dict[str, str],
    query_vectors: dict[str, list[float]],
) -> None:
    for branch in branch_rows:
        assistants = conn.execute(
            """
            SELECT * FROM commits
            WHERE branch_id = ? AND role = 'assistant'
            ORDER BY created_at ASC, id ASC
            """,
            (branch["id"],),
        ).fetchall()
        for assistant in assistants:
            query = queries.get(assistant["id"], "")
            vector = query_vectors.get(query)
            trace = _build_trace(
                conn,
                provider=provider,
                space=space,
                branch=branch,
                assistant=assistant,
                query=query,
                query_vector=np.asarray(vector, dtype=np.float32) if vector else None,
            )
            commits_repo.update_payload(
                conn,
                assistant["id"],
                content=assistant["content"],
                thinking=None,
                trace_json=json.dumps(trace, ensure_ascii=False, separators=(",", ":")),
                status="complete",
            )


async def seed_demo_space(
    conn: sqlite3.Connection, provider: LLMProvider, owner_id: str
) -> sqlite3.Row:
    space, main = spaces_repo.create_with_main(
        conn,
        owner_id,
        DEMO_NAME,
        (
            "A guided BranchMind demo. Branch a reading-list project, choose which "
            "memories carry over, merge one back, and inspect a pending proposal."
        ),
        {
            "assistant_name": "Leafmark guide",
            "about_user": "Product-minded developer building a small reading-list app.",
            "preferences": "Short answers with concrete TypeScript examples.",
        },
    )
    try:
        all_specs = [*MAIN_MEMORIES, INDEXEDDB_MEMORY]
        vectors = await _memory_vectors(provider, [spec[0] for spec in all_specs])

        _exchange(
            conn,
            branch=main,
            user_text=(
                "We're planning a reading-list app called Leafmark. I prefer short "
                "answers with concrete TypeScript examples."
            ),
            assistant_text=(
                "Keep it small: **React + TypeScript** on the frontend, local storage "
                "for persistence, and one `Article` model.\n\n"
                "The first useful slice is a list, a save action, and a detail view. "
                "No server is needed until you want sync."
            ),
            memory_specs=(MAIN_MEMORIES[0], MAIN_MEMORIES[1]),
            vectors=vectors,
            provider=provider,
        )
        _exchange(
            conn,
            branch=main,
            user_text=(
                "Keep the stack simple. Saved articles need tags and a read-later "
                "status. Sketch the data model."
            ),
            assistant_text=(
                "```ts\n"
                "type ArticleStatus = 'unread' | 'reading' | 'done'\n\n"
                "type Article = {\n"
                "  id: string\n"
                "  url: string\n"
                "  title: string\n"
                "  tags: string[]\n"
                "  status: ArticleStatus\n"
                "  addedAt: string\n"
                "}\n"
                "```\n\n"
                "That keeps filtering and read-later state in one record."
            ),
            memory_specs=(MAIN_MEMORIES[2], MAIN_MEMORIES[3]),
            vectors=vectors,
            provider=provider,
        )
        _exchange(
            conn,
            branch=main,
            user_text="Show me a compact TypeScript helper for adding an article.",
            assistant_text=(
                "```ts\n"
                "const addArticle = (url: string, title: string): Article => ({\n"
                "  id: crypto.randomUUID(),\n"
                "  url,\n"
                "  title,\n"
                "  tags: [],\n"
                "  status: 'unread',\n"
                "  addedAt: new Date().toISOString(),\n"
                "})\n"
                "```\n\n"
                "Tags and status stay editable without changing the shape."
            ),
            vectors=vectors,
            provider=provider,
        )
        fresh_main = conn.execute("SELECT * FROM branches WHERE id = ?", (main["id"],)).fetchone()
        assert fresh_main is not None
        main_assistants = [
            row for row in visible_messages(conn, fresh_main) if row["role"] == "assistant"
        ]
        baseline = main_assistants[-1]
        early = main_assistants[1]
        checkpoints_repo.create(
            conn,
            branch_id=main["id"],
            commit_id=baseline["id"],
            name="Baseline before experiments",
        )

        stack_memory = conn.execute(
            "SELECT * FROM memories WHERE space_id = ? AND content = ?",
            (space["id"], MAIN_MEMORIES[2][0]),
        ).fetchone()
        assert stack_memory is not None

        examples, _examples_anchor = branches_repo.create(
            conn,
            space_id=space["id"],
            name="typescript-examples",
            parent_branch_id=main["id"],
            fork_commit_id=baseline["id"],
            persona="A TypeScript mentor who prefers small, runnable examples.",
            thinking_level="high",
            top_k=5,
        )
        _user, _examples_assistant = _exchange(
            conn,
            branch=examples,
            user_text=(
                "Show me how to persist articles with IndexedDB in TypeScript for offline reading."
            ),
            assistant_text=(
                "```ts\n"
                "const openDb = (): Promise<IDBDatabase> =>\n"
                "  new Promise((resolve, reject) => {\n"
                "    const request = indexedDB.open('leafmark', 1)\n"
                "    request.onupgradeneeded = () =>\n"
                "      request.result.createObjectStore('articles', { keyPath: 'id' })\n"
                "    request.onsuccess = () => resolve(request.result)\n"
                "    request.onerror = () => reject(request.error)\n"
                "  })\n"
                "```\n\n"
                "Store the whole `Article` record. The UI can read from IndexedDB "
                "first and fall back to the network later."
            ),
            memory_specs=(INDEXEDDB_MEMORY,),
            vectors=vectors,
            provider=provider,
        )
        memories_repo.set_override(
            conn,
            examples["id"],
            stack_memory["id"],
            excluded=1,
        )

        minimal, _minimal_anchor = branches_repo.create(
            conn,
            space_id=space["id"],
            name="minimal-ui",
            parent_branch_id=main["id"],
            fork_commit_id=early["id"],
            persona="A calm interface designer. Prefer whitespace and clear hierarchy.",
            thinking_level="low",
            top_k=4,
        )
        _user, minimal_assistant = _exchange(
            conn,
            branch=minimal,
            user_text="What should the reading view look like?",
            assistant_text=(
                "Give each article one calm row: title, source, tags, and a quiet "
                "status control.\n\n"
                "- 16px vertical rhythm between rows\n"
                "- one accent color for the active filter\n"
                "- no card inside a card\n"
                "- keep the reading column near 65 characters\n\n"
                "The empty space is what makes the list easy to scan."
            ),
            vectors=vectors,
            provider=provider,
        )
        memories_repo.set_override(
            conn,
            minimal["id"],
            stack_memory["id"],
            excluded=1,
        )
        proposals_repo.create(
            conn,
            branch_id=minimal["id"],
            commit_id=minimal_assistant["id"],
            content=UI_PROPOSAL[0],
            kind=UI_PROPOSAL[1],
            importance=UI_PROPOSAL[2],
            reason="Durable preference found in the demo conversation.",
        )

        index_memory = conn.execute(
            "SELECT * FROM memories WHERE space_id = ? AND content = ?",
            (space["id"], INDEXEDDB_MEMORY[0]),
        ).fetchone()
        assert index_memory is not None
        main_head_row = conn.execute(
            "SELECT head_commit_id FROM branches WHERE id = ?", (main["id"],)
        ).fetchone()
        main_head_id = main_head_row["head_commit_id"] if main_head_row else None
        merge_commit = commits_repo.create(
            conn,
            space_id=space["id"],
            branch_id=main["id"],
            role="merge",
            parent_id=main_head_id,
            content=(
                "Merged the IndexedDB offline-reading preference from "
                "typescript-examples so future branches can reuse it."
            ),
            source_branch_id=examples["id"],
        )
        memories_repo.create(
            conn,
            space_id=space["id"],
            origin_branch_id=main["id"],
            source_commit_id=merge_commit["id"],
            content=index_memory["content"],
            kind=index_memory["kind"],
            importance=index_memory["importance"],
            embedding=index_memory["embedding"],
            embedding_model=index_memory["embedding_model"],
            embedding_dim=index_memory["embedding_dim"],
            derived_from_id=index_memory["id"],
        )

        branch_rows = branches_repo.list_for_space(conn, space["id"])
        queries: dict[str, str] = {}
        for branch in branch_rows:
            for assistant in conn.execute(
                "SELECT id, parent_id FROM commits WHERE branch_id = ? AND role = 'assistant'",
                (branch["id"],),
            ).fetchall():
                parent = commits_repo.get(conn, assistant["parent_id"])
                if parent is not None:
                    queries[assistant["id"]] = parent["content"]
        query_vectors = await _query_vectors(provider, list(dict.fromkeys(queries.values())))
        _seed_traces(
            conn,
            provider=provider,
            space=space,
            branch_rows=branch_rows,
            queries=queries,
            query_vectors=query_vectors,
        )
    except Exception:
        spaces_repo.delete(conn, space["id"], owner_id)
        raise

    row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space["id"],)).fetchone()
    assert row is not None
    return row
