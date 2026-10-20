from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("chathub.jobs")


def staleness_sweep(
    conn: sqlite3.Connection,
    space_id: str,
    expired_memory_id: str | None = None,
) -> dict[str, Any]:
    """Scans active memories in a space and flags expired or stale memories."""
    now_iso = datetime.now(UTC).isoformat()
    flagged_ids: list[str] = []

    # If a specific memory is targeted for immediate expiration/staleness
    if expired_memory_id:
        target = conn.execute(
            "SELECT * FROM memories WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
            (expired_memory_id, space_id),
        ).fetchone()
        if target:
            past_iso = "2020-01-01T00:00:00+00:00"
            conn.execute(
                """
                UPDATE memories
                SET status = 'stale', expires_at = ?, version = version + 1
                WHERE id = ?
                """,
                (past_iso, expired_memory_id),
            )
            event_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO memory_events (
                    id, memory_id, branch_id, actor, action, before_json, after_json, created_at
                )
                VALUES (?, ?, ?, 'system', 'stale_flagged', ?, ?, ?)
                """,
                (
                    event_id,
                    expired_memory_id,
                    target["origin_branch_id"],
                    json.dumps({"status": target["status"]}),
                    json.dumps({"status": "stale", "expires_at": past_iso}),
                    now_iso,
                ),
            )
            flagged_ids.append(expired_memory_id)

    # General sweep for any active memories whose expires_at is in the past
    rows = conn.execute(
        """
        SELECT * FROM memories
        WHERE space_id = ?
          AND status = 'active'
          AND deleted_at IS NULL
          AND expires_at IS NOT NULL
          AND expires_at <= ?
        """,
        (space_id, now_iso),
    ).fetchall()

    for row in rows:
        mem_id = row["id"]
        if mem_id in flagged_ids:
            continue
        conn.execute(
            "UPDATE memories SET status = 'stale', version = version + 1 WHERE id = ?",
            (mem_id,),
        )
        event_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO memory_events (
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            )
            VALUES (?, ?, ?, 'system', 'stale_flagged', ?, ?, ?)
            """,
            (
                event_id,
                mem_id,
                row["origin_branch_id"],
                json.dumps({"status": row["status"]}),
                json.dumps({"status": "stale", "expires_at": row["expires_at"]}),
                now_iso,
            ),
        )
        flagged_ids.append(mem_id)

    if flagged_ids:
        conn.commit()
        logger.info("Staleness sweep flagged %d memories in space %s", len(flagged_ids), space_id)

    return {
        "flagged_count": len(flagged_ids),
        "flagged_ids": flagged_ids,
        "swept_at": now_iso,
    }


def contradiction_sweep(conn: sqlite3.Connection, space_id: str) -> list[dict[str, Any]]:
    """Identifies active memories in the same space that contradict each other by subject_key."""
    rows = conn.execute(
        """
        SELECT id, origin_branch_id, content, kind, subject_key, content_hash, created_at
        FROM memories
        WHERE space_id = ?
          AND status = 'active'
          AND deleted_at IS NULL
          AND subject_key IS NOT NULL
          AND subject_key != ''
        ORDER BY subject_key, created_at ASC
        """,
        (space_id,),
    ).fetchall()

    by_subject: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        key = r["subject_key"]
        by_subject.setdefault(key, []).append(dict(r))

    contradictions: list[dict[str, Any]] = []
    for key, items in by_subject.items():
        if len(items) < 2:
            continue
        # Compare content texts (normalized)
        distinct_contents = {item["content"].strip().lower() for item in items}
        if len(distinct_contents) > 1:
            contradictions.append(
                {
                    "subject_key": key,
                    "count": len(items),
                    "memory_ids": [m["id"] for m in items],
                    "memories": items,
                }
            )

    return contradictions


def enqueue_job(
    conn: sqlite3.Connection,
    job_type: str,
    payload: dict[str, Any] | None = None,
) -> str:
    """Enqueues a background consolidation job."""
    job_id = str(uuid.uuid4())
    now_iso = datetime.now(UTC).isoformat()
    conn.execute(
        """
        INSERT INTO jobs (id, type, payload_json, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
        """,
        (job_id, job_type, json.dumps(payload or {}), now_iso),
    )
    conn.commit()
    return job_id
