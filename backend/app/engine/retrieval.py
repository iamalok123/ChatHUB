from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np

from app.engine.context import estimate_tokens
from app.llm.base import LLMProvider
from app.llm.embeddings import cosine, from_blob, is_stale_embedding
from app.llm.qdrant import QdrantStore
from app.visibility import effective_memories, excluded_memories

MIN_SCORE = 0.25
MAX_QUERY_CHARS = 3000
PREVIOUS_ASSISTANT_CHARS = 600


@dataclass
class RetrievalResult:
    selected: list[dict[str, Any]] = field(default_factory=list)
    selected_details: list[dict[str, Any]] = field(default_factory=list)
    considered: list[dict[str, Any]] = field(default_factory=list)
    excluded: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    query: str = ""
    query_tokens: int = 0
    used_tokens: int = 0
    duration_ms: int = 0
    top_k: int = 6

    def step_payload(self) -> dict[str, Any]:
        return {
            "selected": len(self.selected),
            "considered": len(self.considered),
            "excluded": len(self.excluded),
            "tokens": self.used_tokens,
            "warnings": self.warnings,
        }


def _age_days(created_at: str) -> float:
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0.0
    delta = (datetime.now(UTC) - created).total_seconds() / 86400
    return max(0.0, delta)


def recency_decay(created_at: str) -> float:
    return float(0.5 ** (_age_days(created_at) / 30.0))


def _vector(item: dict[str, Any], provider: LLMProvider) -> np.ndarray | None:
    blob = item.get("embedding")
    if blob is None:
        return None
    if is_stale_embedding(
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
    if vector.size != provider.embed_dim:
        return None
    return vector


def _detail(
    item: dict[str, Any],
    *,
    similarity: float | None,
    recency: float,
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
        "recency": round(recency, 4),
        "score": None if score is None else round(score, 4),
        "reason": reason,
        "tokens": estimate_tokens(str(item.get("content", ""))),
    }


def _selection_reason(item: dict[str, Any], similarity: float | None, score: float) -> str:
    if item.get("pinned"):
        return "pinned"
    if similarity is not None and similarity >= 0.75:
        return f"high similarity {similarity:.2f}"
    if item.get("kind") == "preference":
        return "preference"
    return f"selected score {score:.2f}"


def build_query(user_text: str, previous_assistant_text: str | None) -> str:
    query = user_text.strip()
    if previous_assistant_text:
        query += (
            "\n\nPrevious assistant message:\n"
            + previous_assistant_text.strip()[:PREVIOUS_ASSISTANT_CHARS]
        )
    return query[:MAX_QUERY_CHARS]


def _lexical_search(
    conn: Any,
    query: str,
    valid_ids: set[str],
    items: list[dict[str, Any]],
) -> dict[str, float]:
    scores: dict[str, float] = {}
    words = [w for w in re.findall(r"[a-zA-Z0-9]+", query.lower()) if len(w) > 2]
    if words and valid_ids:
        fts_query = " OR ".join(words[:8])
        try:
            cursor = conn.execute(
                "SELECT memory_id, rank FROM memories_fts WHERE memories_fts MATCH ? LIMIT 50",
                (fts_query,),
            )
            rows = cursor.fetchall()
            for row in rows:
                m_id = str(row[0])
                if m_id in valid_ids:
                    scores[m_id] = 1.0 / (1.0 + abs(float(row[1])))
        except Exception:
            pass

    query_words = set(words)
    if query_words:
        for item in items:
            mem_id = item.get("id")
            if not mem_id or mem_id in scores:
                continue
            content_words = set(re.findall(r"\w+", str(item.get("content", "")).lower()))
            overlap = len(query_words & content_words)
            if overlap > 0:
                scores[mem_id] = float(overlap) / max(1, len(content_words))

    return scores


def _apply_mmr(
    candidates: list[dict[str, Any]],
    slots: int,
    memory_budget: int,
    current_tokens: int,
    lambda_mult: float = 0.7,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selected: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    remaining = [c for c in candidates if c.get("_eligible")]
    tokens_used = current_tokens

    while remaining and len(selected) < slots:
        best_candidate: dict[str, Any] | None = None
        best_mmr_score = -float("inf")
        best_index = -1

        for idx, candidate in enumerate(remaining):
            score = float(candidate.get("_score", 0.0))
            cand_vec = candidate.get("_vector")

            max_sim = 0.0
            if cand_vec is not None and selected:
                for sel in selected:
                    sel_vec = sel.get("_vector")
                    if sel_vec is not None:
                        sim = float(cosine(cand_vec, sel_vec))
                        if sim > max_sim:
                            max_sim = sim

            mmr_score = lambda_mult * score - (1.0 - lambda_mult) * max_sim

            if mmr_score > best_mmr_score:
                best_mmr_score = mmr_score
                best_candidate = candidate
                best_index = idx

        if best_candidate is None:
            break

        remaining.pop(best_index)
        cand_tokens = int(
            best_candidate.get("tokens", estimate_tokens(str(best_candidate.get("content", ""))))
        )
        if tokens_used + cand_tokens > memory_budget:
            best_candidate["reason"] = "skipped for memory budget"
            skipped.append(best_candidate)
            continue

        selected.append(best_candidate)
        tokens_used += cand_tokens

    return selected, skipped


async def retrieve_memories(
    conn: Any,
    branch: Any,
    *,
    user_text: str,
    previous_assistant_text: str | None,
    provider: LLMProvider,
    top_k: int,
    memory_budget: int,
    qdrant: QdrantStore | None = None,
) -> RetrievalResult:
    started = time.perf_counter()
    top_k = max(1, min(int(top_k), 50))
    result = RetrievalResult(top_k=top_k)
    result.query = build_query(user_text, previous_assistant_text)
    result.query_tokens = estimate_tokens(result.query)

    memories = effective_memories(conn, branch)
    excluded = excluded_memories(conn, branch)
    names: dict[str, str] = {}
    origin_ids = {
        item.get("origin_branch_id")
        for item in [*memories, *excluded]
        if item.get("origin_branch_id")
    }
    if origin_ids:
        placeholders = ",".join("?" for _ in origin_ids)
        for row in conn.execute(
            f"SELECT id, name FROM branches WHERE id IN ({placeholders})",
            list(origin_ids),
        ).fetchall():
            names[row["id"]] = row["name"]
    for item in excluded:
        item["origin_branch_name"] = names.get(item.get("origin_branch_id"), "unknown")
        item["inherited"] = item.get("origin_branch_id") != branch["id"]
        item["pinned"] = False
        item["edited"] = False
        result.excluded.append(
            _detail(
                item,
                similarity=None,
                recency=recency_decay(item.get("created_at", "")),
                score=None,
                reason="excluded on this branch",
            )
        )

    if not memories:
        result.duration_ms = int((time.perf_counter() - started) * 1000)
        return result

    query_vector: np.ndarray | None = None
    try:
        vectors = await provider.embed([result.query], task_type="RETRIEVAL_QUERY")
        if vectors:
            candidate = np.asarray(vectors[0], dtype=np.float32)
            if candidate.size == provider.embed_dim:
                query_vector = candidate
            else:
                result.warnings.append(
                    "The query embedding had an unexpected dimension; pinned memories were kept."
                )
    except Exception as exc:
        code = getattr(exc, "code", type(exc).__name__)
        result.warnings.append(
            f"Memory similarity search was unavailable ({code}); pinned memories were kept."
        )

    valid_ids = {m["id"] for m in memories if m.get("id")}
    qdrant_similarities: dict[str, float] = {}
    if qdrant and qdrant.is_enabled and query_vector is not None:
        qdrant_similarities = qdrant.search_similarities(
            query_vector, list(valid_ids), limit=len(valid_ids)
        )

    lexical_scores = _lexical_search(conn, result.query, valid_ids, memories)
    lex_sorted = sorted(lexical_scores.items(), key=lambda kv: -kv[1])
    lex_ranks = {m_id: rank + 1 for rank, (m_id, _) in enumerate(lex_sorted)}

    dense_candidates: list[tuple[str, float]] = []
    for m in memories:
        m_id = m.get("id")
        if not m_id:
            continue
        if m_id in qdrant_similarities:
            dense_candidates.append((m_id, qdrant_similarities[m_id]))
        else:
            vec = _vector(m, provider)
            sim = (
                cosine(query_vector, vec) if (query_vector is not None and vec is not None) else 0.0
            )
            dense_candidates.append((m_id, sim))
    dense_sorted = sorted(dense_candidates, key=lambda kv: -kv[1])
    dense_ranks = {m_id: rank + 1 for rank, (m_id, _) in enumerate(dense_sorted)}

    scored: list[dict[str, Any]] = []
    stale_count = 0
    for item in memories:
        vector = _vector(item, provider)
        recency = recency_decay(item.get("created_at", ""))
        mem_id = item.get("id")
        has_qdrant_match = mem_id in qdrant_similarities
        if vector is None and not has_qdrant_match:
            stale_count += 1
            entry = _detail(
                item,
                similarity=None,
                recency=recency,
                score=None,
                reason="stale embedding",
            )
            entry["_item"] = item
            entry["_vector"] = None
            entry["_eligible"] = bool(item.get("pinned"))
            entry["_score"] = float(item.get("importance", 0.5)) * 0.25 + recency * 0.15
            scored.append(entry)
            continue
        if query_vector is None:
            entry = _detail(
                item,
                similarity=None,
                recency=recency,
                score=None,
                reason="similarity search unavailable",
            )
            entry["_item"] = item
            entry["_vector"] = None
            entry["_eligible"] = bool(item.get("pinned"))
            entry["_score"] = float(item.get("importance", 0.5)) * 0.25 + recency * 0.15
            scored.append(entry)
            continue

        if has_qdrant_match:
            similarity = qdrant_similarities[mem_id]
        else:
            similarity = cosine(query_vector, vector) if vector is not None else 0.0

        if lexical_scores:
            dense_rank = dense_ranks.get(mem_id, 100)
            lex_rank = lex_ranks.get(mem_id, 100)
            rrf = (1.0 / (60 + dense_rank)) + (1.0 / (60 + lex_rank))
            rrf_norm = rrf / (2.0 / 61.0)
            hybrid_sim = max(similarity, 0.6 * similarity + 0.4 * rrf_norm)
        else:
            hybrid_sim = similarity

        score = 0.60 * hybrid_sim + 0.25 * float(item.get("importance", 0.5)) + 0.15 * recency
        entry = _detail(
            item,
            similarity=similarity,
            recency=recency,
            score=score,
            reason=_selection_reason(item, similarity, score),
        )
        entry["_item"] = item
        entry["_vector"] = vector
        entry["_score"] = score
        entry["_eligible"] = bool(item.get("pinned")) or score >= MIN_SCORE
        scored.append(entry)

    if stale_count:
        result.warnings.append(
            f"{stale_count} memories have stale or missing embeddings; "
            "rebuild embeddings to restore similarity search."
        )

    pinned = [entry for entry in scored if entry["_item"].get("pinned")]
    pinned.sort(key=lambda entry: (-float(entry["_item"].get("importance", 0.5)), entry["id"]))
    unpinned = [entry for entry in scored if not entry["_item"].get("pinned")]
    unpinned.sort(key=lambda entry: (-float(entry["_score"]), entry["id"]))

    selected_ids: set[str] = set()
    used_tokens = 0
    for entry in pinned:
        detail = {key: value for key, value in entry.items() if not key.startswith("_")}
        detail["reason"] = "pinned"
        result.selected.append(entry["_item"])
        result.selected_details.append(detail)
        selected_ids.add(entry["id"])
        used_tokens += int(entry["tokens"])

    slots = max(0, top_k - len(pinned))
    mmr_selected, mmr_skipped = _apply_mmr(
        candidates=unpinned,
        slots=slots,
        memory_budget=memory_budget,
        current_tokens=used_tokens,
        lambda_mult=0.7,
    )
    for entry in mmr_selected:
        result.selected.append(entry["_item"])
        result.selected_details.append(
            {key: value for key, value in entry.items() if not key.startswith("_")}
        )
        selected_ids.add(entry["id"])
        used_tokens += int(entry["tokens"])

    for entry in mmr_skipped:
        entry["reason"] = "skipped for memory budget"

    if used_tokens > memory_budget:
        result.warnings.append("Pinned memories exceeded the configured memory token budget.")

    for entry in scored:
        if entry["id"] in selected_ids:
            continue
        considered = {key: value for key, value in entry.items() if not key.startswith("_")}
        if considered["reason"] == "stale embedding":
            considered["reason"] = "stale embedding"
        elif considered["reason"] == "similarity search unavailable":
            considered["reason"] = "similarity search unavailable"
        elif considered["reason"] == "skipped for memory budget":
            pass
        elif not entry["_eligible"]:
            considered["reason"] = "below score threshold"
        else:
            considered["reason"] = "not in top results"
        result.considered.append(considered)

    result.used_tokens = used_tokens
    result.duration_ms = int((time.perf_counter() - started) * 1000)
    return result
