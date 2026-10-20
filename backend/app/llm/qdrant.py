from __future__ import annotations

import logging
from typing import Any

import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    HasIdCondition,
    MatchAny,
    PointStruct,
    VectorParams,
)

logger = logging.getLogger("chathub.qdrant")


class QdrantStore:
    """Manages memory vector indexing and filtered similarity search via Qdrant."""

    def __init__(
        self,
        url: str = "",
        api_key: str = "",
        collection: str = "chathub_memories",
        dim: int = 768,
    ) -> None:
        self.url = url.strip()
        self.api_key = api_key.strip()
        self.collection = collection
        self.dim = dim
        self._client: QdrantClient | None = None

    @property
    def is_enabled(self) -> bool:
        return bool(self.url)

    def get_client(self) -> QdrantClient:
        if self._client is None:
            if self.url:
                self._client = QdrantClient(url=self.url, api_key=self.api_key or None)
            else:
                self._client = QdrantClient(":memory:")
            self._ensure_collection()
        return self._client

    def _ensure_collection(self) -> None:
        try:
            client = self._client
            if client:
                if not client.collection_exists(self.collection):
                    client.create_collection(
                        collection_name=self.collection,
                        vectors_config=VectorParams(size=self.dim, distance=Distance.COSINE),
                    )
                    logger.info(
                        "Initialized Qdrant collection '%s' (dim=%d)", self.collection, self.dim
                    )
                try:
                    client.create_payload_index(
                        collection_name=self.collection,
                        field_name="memory_id",
                        field_schema="keyword",
                    )
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("Could not initialize Qdrant collection '%s': %s", self.collection, exc)

    def upsert_memory(
        self,
        memory_id: str,
        vector: list[float] | np.ndarray,
        payload: dict[str, Any] | None = None,
    ) -> None:
        if not self.is_enabled:
            return
        try:
            client = self.get_client()
            vec = [float(v) for v in vector]
            pl = dict(payload or {})
            pl["memory_id"] = memory_id
            client.upsert(
                collection_name=self.collection,
                points=[PointStruct(id=memory_id, vector=vec, payload=pl)],
            )
        except Exception as exc:
            logger.warning("Failed to upsert memory %s to Qdrant: %s", memory_id, exc)

    def delete_memory(self, memory_id: str) -> None:
        if not self.is_enabled:
            return
        try:
            client = self.get_client()
            client.delete(
                collection_name=self.collection,
                points_selector=[memory_id],
            )
        except Exception as exc:
            logger.warning("Failed to delete memory %s from Qdrant: %s", memory_id, exc)

    def search_similarities(
        self,
        query_vector: list[float] | np.ndarray,
        allowed_memory_ids: list[str],
        limit: int = 50,
    ) -> dict[str, float]:
        """Returns {memory_id: cosine_similarity} filtered to allowed memory IDs."""
        if not self.is_enabled or not allowed_memory_ids:
            return {}
        try:
            client = self.get_client()
            vec = [float(v) for v in query_vector]
            results = client.query_points(
                collection_name=self.collection,
                query=vec,
                query_filter=Filter(
                    must=[HasIdCondition(has_id=allowed_memory_ids)]
                ),
                limit=limit,
            )
            return {str(point.id): float(point.score) for point in results.points}
        except Exception as exc:
            logger.warning("Qdrant similarity query failed, falling back to local: %s", exc)
            return {}
