from __future__ import annotations

import numpy as np

from app.llm.base import ProviderError


def to_blob(vector: list[float] | np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    if left.size == 0 or right.size == 0 or left.size != right.size:
        return 0.0
    left_norm = float(np.linalg.norm(left))
    right_norm = float(np.linalg.norm(right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    value = float(np.dot(left, right) / (left_norm * right_norm))
    return max(-1.0, min(1.0, value))


def validate_vectors(
    vectors: list[list[float]], expected_count: int, expected_dim: int
) -> list[list[float]]:
    if len(vectors) != expected_count:
        raise ProviderError(
            "embedding_count_mismatch",
            "Embedding provider returned the wrong number of vectors",
        )
    result: list[list[float]] = []
    for vector in vectors:
        if len(vector) != expected_dim:
            raise ProviderError(
                "embedding_dim_mismatch",
                "Embedding provider returned vectors with an unexpected dimension",
            )
        cleaned = [float(value) for value in vector]
        if not all(np.isfinite(cleaned)):
            raise ProviderError(
                "embedding_not_finite", "Embedding provider returned invalid values"
            )
        result.append(cleaned)
    return result


def is_stale_embedding(
    stored_model: str | None,
    stored_dim: int | None,
    current_model: str,
    current_dim: int,
) -> bool:
    return stored_model != current_model or stored_dim != current_dim
