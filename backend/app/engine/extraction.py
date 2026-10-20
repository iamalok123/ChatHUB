from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.config import Settings
from app.db import Database
from app.engine.classifiers import (
    detect_prompt_injection,
    detect_secret,
    detect_sensitivity,
    infer_subject_key,
)
from app.llm.base import LLMProvider, MemoryCandidate
from app.llm.embeddings import cosine, from_blob, is_stale_embedding, to_blob
from app.repo import memories as memories_repo
from app.repo import proposals as proposals_repo
from app.viewmodels import memory_out
from app.visibility import effective_memories

logger = logging.getLogger("branchmind.extraction")

DUPLICATE_THRESHOLD = 0.90
CONFLICT_THRESHOLD = 0.75
ALLOWED_KINDS = {"fact", "preference", "decision", "profile", "summary", "task"}


@dataclass
class ExtractionResult:
    mode: str
    status: str
    proposals: list[dict[str, Any]] = field(default_factory=list)
    auto_saved: list[dict[str, Any]] = field(default_factory=list)
    operations: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duration_ms: int = 0


def _memory_vector(item: dict[str, Any], provider: LLMProvider) -> np.ndarray | None:
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


def _proposal_payload(
    row: sqlite3.Row,
    *,
    conflict_content: str | None,
    conflict_kind: str | None,
) -> dict[str, Any]:
    return {
        "id": row["id"],
        "branch_id": row["branch_id"],
        "commit_id": row["commit_id"],
        "content": row["content"],
        "kind": row["kind"] or "fact",
        "importance": float(row["importance"] if row["importance"] is not None else 0.5),
        "status": row["status"],
        "reason": row["reason"] or "",
        "conflicts_with_memory_id": row["conflicts_with_memory_id"],
        "conflict_content": conflict_content,
        "conflict_kind": conflict_kind,
        "accepted_memory_id": row["accepted_memory_id"],
        "resolution": row["resolution"],
        "created_at": row["created_at"],
    }


class MemoryExtractor:
    def __init__(self, database: Database, provider: LLMProvider, settings: Settings) -> None:
        self.database = database
        self.provider = provider
        self.settings = settings

    async def extract(
        self,
        *,
        branch_id: str,
        assistant_commit_id: str,
        user_text: str,
        assistant_text: str,
    ) -> ExtractionResult:
        started = time.perf_counter()
        conn = self.database.connect()
        try:
            branch = conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()
            if branch is None:
                return ExtractionResult(
                    mode="unknown",
                    status="error",
                    warnings=["The branch disappeared before memory extraction."],
                    duration_ms=int((time.perf_counter() - started) * 1000),
                )
            mode = branch["memory_mode"] or "review"
            if mode == "off":
                return ExtractionResult(
                    mode="off",
                    status="skipped",
                    operations=[{"op": "extraction_skipped", "reason": "memory_mode=off"}],
                    duration_ms=int((time.perf_counter() - started) * 1000),
                )
            try:
                candidates = await self.provider.extract_memories(
                    user_text=user_text,
                    assistant_text=assistant_text,
                    max_candidates=self.settings.extraction_max_candidates,
                )
            except Exception as exc:
                logger.warning("Memory extraction failed: %s", type(exc).__name__)
                code = getattr(exc, "code", type(exc).__name__)
                return ExtractionResult(
                    mode=mode,
                    status="error",
                    operations=[{"op": "extraction_error", "code": str(code)}],
                    warnings=["Memory extraction failed; the reply was kept without new memories."],
                    duration_ms=int((time.perf_counter() - started) * 1000),
                )

            cleaned = self._clean_candidates(candidates)
            if not cleaned:
                return ExtractionResult(
                    mode=mode,
                    status="done",
                    duration_ms=int((time.perf_counter() - started) * 1000),
                )

            result = ExtractionResult(
                mode=mode,
                status="done",
                duration_ms=0,
            )
            candidate_vectors = await self._embed_candidates(cleaned, result)
            effective = effective_memories(conn, branch)
            comparison: list[tuple[dict[str, Any], np.ndarray | None]] = [
                (item, _memory_vector(item, self.provider)) for item in effective
            ]
            existing_text = {str(item.get("content", "")).strip().lower() for item in effective}

            for index, candidate in enumerate(cleaned):
                vector = candidate_vectors[index]
                duplicate, conflict, similarity = self._classify(candidate, vector, comparison)
                if duplicate is not None:
                    result.operations.append(
                        {
                            "op": "duplicate_skipped",
                            "content": candidate.content,
                            "similarity": round(similarity or 0.0, 4),
                            "existing_memory_id": duplicate.get("id"),
                        }
                    )
                    continue
                if candidate.content.strip().lower() in existing_text:
                    result.operations.append(
                        {
                            "op": "duplicate_skipped",
                            "content": candidate.content,
                            "reason": "identical content",
                            "existing_memory_id": None,
                        }
                    )
                    continue

                conflict_content = conflict.get("content") if conflict else None
                conflict_kind = conflict.get("kind") if conflict else None
                reason = (
                    f"Similar to an existing {conflict_kind} memory ({similarity:.2f})"
                    if conflict is not None
                    else "New durable memory"
                )
                if mode == "review" or conflict is not None:
                    row = proposals_repo.create(
                        conn,
                        branch_id=branch_id,
                        commit_id=assistant_commit_id,
                        content=candidate.content,
                        kind=candidate.kind,
                        importance=candidate.importance,
                        conflicts_with_memory_id=(
                            conflict.get("id") if conflict is not None else None
                        ),
                        reason=reason,
                    )
                    result.proposals.append(
                        _proposal_payload(
                            row,
                            conflict_content=conflict_content,
                            conflict_kind=conflict_kind,
                        )
                    )
                    result.operations.append(
                        {
                            "op": "proposal_created",
                            "proposal_id": row["id"],
                            "content": candidate.content,
                            "kind": candidate.kind,
                            "conflict_with": (conflict.get("id") if conflict is not None else None),
                        }
                    )
                    existing_text.add(candidate.content.strip().lower())
                    continue

                if mode == "auto":
                    embedding = to_blob(vector) if vector is not None else None
                    sensitivity = detect_sensitivity(candidate.content)
                    subject_key = infer_subject_key(candidate.content, candidate.kind)
                    row = memories_repo.create(
                        conn,
                        space_id=branch["space_id"],
                        origin_branch_id=branch_id,
                        source_commit_id=assistant_commit_id,
                        content=candidate.content,
                        kind=candidate.kind,
                        importance=candidate.importance,
                        embedding=embedding,
                        embedding_model=(
                            self.provider.embed_model if embedding is not None else None
                        ),
                        embedding_dim=(self.provider.embed_dim if embedding is not None else None),
                        sensitivity=sensitivity,
                        subject_key=subject_key,
                    )
                    comparison.append((dict(row), vector))
                    existing_text.add(candidate.content.strip().lower())
                    result.auto_saved.append(
                        memory_out(
                            row,
                            provider=self.provider,
                            origin_branch_name=branch["name"],
                        ).model_dump(mode="json")
                    )
                    result.operations.append(
                        {
                            "op": "memory_auto_saved",
                            "memory_id": row["id"],
                            "content": candidate.content,
                            "kind": candidate.kind,
                        }
                    )

            result.duration_ms = int((time.perf_counter() - started) * 1000)
            return result
        except Exception:
            logger.exception("Unexpected memory extraction failure")
            return ExtractionResult(
                mode="unknown",
                status="error",
                operations=[{"op": "extraction_error", "code": "internal_error"}],
                warnings=["Memory extraction failed unexpectedly."],
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
        finally:
            conn.close()

    def _clean_candidates(self, candidates: list[MemoryCandidate]) -> list[MemoryCandidate]:
        cleaned: list[MemoryCandidate] = []
        seen: set[str] = set()
        limit = max(1, min(self.settings.extraction_max_candidates, 10))
        for candidate in candidates:
            content = str(candidate.content).strip()
            if not content or len(content) > 500:
                continue
            if detect_secret(content) or detect_prompt_injection(content):
                continue
            key = content.lower()
            if key in seen:
                continue
            seen.add(key)
            kind = candidate.kind if candidate.kind in ALLOWED_KINDS else "fact"
            importance = max(0.0, min(1.0, float(candidate.importance)))
            cleaned.append(MemoryCandidate(content=content, kind=kind, importance=importance))
            if len(cleaned) >= limit:
                break
        return cleaned

    async def _embed_candidates(
        self, candidates: list[MemoryCandidate], result: ExtractionResult
    ) -> list[np.ndarray | None]:
        try:
            vectors = await self.provider.embed(
                [candidate.content for candidate in candidates],
                task_type="RETRIEVAL_DOCUMENT",
            )
        except Exception as exc:
            code = getattr(exc, "code", type(exc).__name__)
            result.warnings.append(
                f"Candidate embeddings failed ({code}); new memories were stored "
                "without similarity metadata."
            )
            return [None for _ in candidates]
        return [
            np.asarray(vector, dtype=np.float32) if vector is not None else None
            for vector in vectors
        ]

    def _classify(
        self,
        candidate: MemoryCandidate,
        vector: np.ndarray | None,
        comparison: list[tuple[dict[str, Any], np.ndarray | None]],
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None, float | None]:
        if vector is None:
            return None, None, None
        best_conflict: dict[str, Any] | None = None
        best_similarity: float | None = None
        for item, memory_vector in comparison:
            if memory_vector is None:
                continue
            similarity = cosine(vector, memory_vector)
            if similarity > DUPLICATE_THRESHOLD:
                return item, None, similarity
            if (
                similarity >= CONFLICT_THRESHOLD
                and item.get("kind") == candidate.kind
                and (best_similarity is None or similarity > best_similarity)
            ):
                best_conflict = item
                best_similarity = similarity
        return None, best_conflict, best_similarity
