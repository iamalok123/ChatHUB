from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.llm.base import LLMProvider
from app.llm.embeddings import cosine, from_blob, is_stale_embedding

DUPLICATE_THRESHOLD = 0.92


@dataclass
class CopyPlan:
    copies: list[tuple[dict[str, Any], np.ndarray | None]] = field(default_factory=list)
    duplicates: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def normalize_content(content: str) -> str:
    return " ".join(str(content).strip().lower().split())


def stored_vector(item: dict[str, Any], provider: LLMProvider) -> np.ndarray | None:
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


async def build_copy_plan(
    provider: LLMProvider,
    candidates: list[dict[str, Any]],
    target_items: list[dict[str, Any]],
) -> CopyPlan:
    plan = CopyPlan()
    if not candidates:
        return plan

    comparison = list(target_items)
    target_stale = sum(1 for item in target_items if stored_vector(item, provider) is None)
    if target_stale:
        plan.warnings.append(
            f"{target_stale} target memories have stale or missing embeddings; "
            "near-duplicate checks are limited."
        )

    vectors: list[np.ndarray | None]
    try:
        embedded = await provider.embed(
            [str(item.get("content", "")) for item in candidates],
            task_type="RETRIEVAL_DOCUMENT",
        )
        if len(embedded) != len(candidates):
            raise ValueError("embedding count mismatch")
        vectors = [np.asarray(vector, dtype=np.float32) for vector in embedded]
    except Exception as exc:
        code = getattr(exc, "code", type(exc).__name__)
        plan.warnings.append(
            f"Candidate embeddings failed ({code}); only exact duplicate checks were applied."
        )
        vectors = [None for _ in candidates]

    comparison_vectors: list[np.ndarray | None] = [
        stored_vector(item, provider) for item in comparison
    ]
    comparison_text = {normalize_content(item.get("content", "")) for item in comparison}

    for item, vector in zip(candidates, vectors, strict=True):
        text = normalize_content(item.get("content", ""))
        duplicate_id: str | None = None
        duplicate_similarity = 0.0
        if text in comparison_text:
            match = next(
                (
                    existing
                    for existing in comparison
                    if normalize_content(existing.get("content", "")) == text
                ),
                None,
            )
            if match is not None:
                duplicate_id = str(match.get("id"))
                duplicate_similarity = 1.0

        if duplicate_id is None and vector is not None:
            for existing, existing_vector in zip(comparison, comparison_vectors, strict=True):
                if existing_vector is None:
                    continue
                similarity = cosine(vector, existing_vector)
                if similarity > DUPLICATE_THRESHOLD and similarity > duplicate_similarity:
                    duplicate_id = str(existing.get("id"))
                    duplicate_similarity = similarity

        if duplicate_id is not None:
            plan.duplicates.append(
                {
                    "memory_id": item["id"],
                    "duplicate_of_memory_id": duplicate_id,
                    "similarity": round(duplicate_similarity, 4),
                }
            )
            continue

        plan.copies.append((item, vector))
        comparison.append(item)
        comparison_vectors.append(vector)
        comparison_text.add(text)

    return plan
