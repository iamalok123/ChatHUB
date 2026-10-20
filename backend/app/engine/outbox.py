from __future__ import annotations

import asyncio
import json
import logging

from app.clock import utc_now
from app.db import Database
from app.llm.embeddings import from_blob
from app.llm.qdrant import QdrantStore

logger = logging.getLogger("chathub.outbox")


class OutboxProcessor:
    @staticmethod
    def process_batch(database: Database, qdrant: QdrantStore | None, limit: int = 50) -> int:
        conn = database.connect()
        try:
            events = conn.execute(
                """
                SELECT id, memory_id, op, payload_json, attempts
                FROM outbox_events
                WHERE status = 'pending' AND attempts < 5
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            if not events:
                return 0

            processed_count = 0
            for event in events:
                event_id = event["id"]
                mem_id = event["memory_id"]
                op = event["op"]
                now = utc_now()

                try:
                    payload = json.loads(event["payload_json"] or "{}")

                    if qdrant and qdrant.is_enabled:
                        if op == "upsert":
                            mem_row = conn.execute(
                                "SELECT embedding, embedding_dim FROM memories WHERE id = ?",
                                (mem_id,),
                            ).fetchone()
                            if mem_row and mem_row["embedding"]:
                                vec = from_blob(mem_row["embedding"])
                                qdrant.upsert_memory(
                                    memory_id=mem_id,
                                    vector=vec,
                                    payload={
                                        "space_id": payload.get("space_id"),
                                        "branch_id": payload.get("branch_id"),
                                        "content": payload.get("content", ""),
                                        "kind": payload.get("kind", "fact"),
                                    },
                                )
                        elif op == "delete":
                            qdrant.delete_memory(mem_id)

                    conn.execute(
                        """
                        UPDATE outbox_events
                        SET status = 'completed', processed_at = ?
                        WHERE id = ?
                        """,
                        (now, event_id),
                    )
                    conn.commit()
                    processed_count += 1
                except Exception as exc:
                    logger.warning("Failed to process outbox event %s: %s", event_id, exc)
                    conn.execute(
                        """
                        UPDATE outbox_events
                        SET attempts = attempts + 1,
                            error = ?,
                            status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
                        WHERE id = ?
                        """,
                        (str(exc), event_id),
                    )
                    conn.commit()

            return processed_count
        finally:
            conn.close()

    @staticmethod
    async def run_worker(
        database: Database,
        qdrant: QdrantStore | None,
        interval_seconds: float = 3.0,
    ) -> None:
        while True:
            try:
                OutboxProcessor.process_batch(database, qdrant)
            except Exception as exc:
                logger.error("Outbox worker loop error: %s", exc)
            await asyncio.sleep(interval_seconds)
