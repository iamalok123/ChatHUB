from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from app.clock import new_id, utc_now
from app.errors import ApiError, not_found

logger = logging.getLogger("chathub.memory_service")


def content_hash(text: str) -> str:
    normalized = " ".join(text.strip().lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class MemoryService:
    @staticmethod
    def get(conn: Any, memory_id: str) -> dict[str, Any] | None:
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return dict(row) if row is not None else None

    @staticmethod
    def create_memory(
        conn: Any,
        *,
        space_id: str,
        origin_branch_id: str,
        source_commit_id: str,
        content: str,
        kind: str = "fact",
        importance: float = 0.5,
        confidence: float = 1.0,
        source_type: str = "user_stated",
        sensitivity: str = "none",
        subject_key: str | None = None,
        status: str = "active",
        supersedes_id: str | None = None,
        derived_from_id: str | None = None,
        embedding: bytes | None = None,
        embedding_model: str | None = None,
        embedding_dim: int | None = None,
        actor: str = "user",
        commit: bool = True,
    ) -> dict[str, Any]:
        mem_id = new_id()
        c_hash = content_hash(content)
        now = utc_now()

        conn.execute(
            """
            INSERT INTO memories(
                id, space_id, origin_branch_id, source_commit_id, content, kind, importance,
                confidence, source_type, sensitivity, subject_key, status, version,
                content_hash, embedding, embedding_model, embedding_dim, supersedes_id,
                derived_from_id, deleted_at, created_at, index_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending')
            """,
            (
                mem_id,
                space_id,
                origin_branch_id,
                source_commit_id,
                content,
                kind,
                importance,
                confidence,
                source_type,
                sensitivity,
                subject_key,
                status,
                c_hash,
                embedding,
                embedding_model,
                embedding_dim,
                supersedes_id,
                derived_from_id,
                now,
            ),
        )

        # Audit event
        after_data = {
            "id": mem_id,
            "content": content,
            "kind": kind,
            "status": status,
            "subject_key": subject_key,
            "version": 1,
        }
        conn.execute(
            """
            INSERT INTO memory_events(
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, 'create', NULL, ?, ?)
            """,
            (new_id(), mem_id, origin_branch_id, actor, json.dumps(after_data), now),
        )

        # Transactional outbox event for Qdrant
        conn.execute(
            """
            INSERT INTO outbox_events(id, memory_id, op, payload_json, status, attempts, created_at)
            VALUES (?, ?, 'upsert', ?, 'pending', 0, ?)
            """,
            (
                new_id(),
                mem_id,
                json.dumps({
                    "id": mem_id,
                    "space_id": space_id,
                    "branch_id": origin_branch_id,
                    "content": content,
                    "kind": kind,
                }),
                now,
            ),
        )

        if commit:
            conn.commit()

        created = MemoryService.get(conn, mem_id)
        assert created is not None
        return created

    @staticmethod
    def update_memory(
        conn: Any,
        memory_id: str,
        *,
        content: str | None = None,
        kind: str | None = None,
        importance: float | None = None,
        confidence: float | None = None,
        sensitivity: str | None = None,
        subject_key: str | None = None,
        expected_version: int | None = None,
        embedding: bytes | None = None,
        embedding_model: str | None = None,
        embedding_dim: int | None = None,
        actor: str = "user",
        commit: bool = True,
    ) -> dict[str, Any]:
        existing = MemoryService.get(conn, memory_id)
        if existing is None or existing.get("deleted_at") is not None:
            raise not_found()

        current_version = existing.get("version", 1)
        if expected_version is not None and expected_version != current_version:
            raise ApiError(409, "version_conflict", "Memory was modified concurrently")

        new_version = current_version + 1
        new_content = content if content is not None else existing["content"]
        new_kind = kind if kind is not None else existing["kind"]
        new_importance = importance if importance is not None else existing["importance"]
        new_confidence = confidence if confidence is not None else existing.get("confidence", 1.0)
        new_sens = (
            sensitivity if sensitivity is not None else existing.get("sensitivity", "none")
        )
        new_subject_key = subject_key if subject_key is not None else existing.get("subject_key")
        new_hash = content_hash(new_content)
        now = utc_now()

        # Archive prior version for undo
        conn.execute(
            """
            INSERT INTO memory_versions(id, memory_id, version, content, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (new_id(), memory_id, current_version, existing["content"], existing["kind"], now),
        )

        # Update record
        conn.execute(
            """
            UPDATE memories
            SET content = ?, kind = ?, importance = ?, confidence = ?, sensitivity = ?,
                subject_key = ?, content_hash = ?, version = ?, embedding = ?,
                embedding_model = ?, embedding_dim = ?, index_state = 'pending'
            WHERE id = ?
            """,
            (
                new_content,
                new_kind,
                new_importance,
                new_confidence,
                new_sens,
                new_subject_key,
                new_hash,
                new_version,
                embedding if embedding is not None else existing.get("embedding"),
                embedding_model if embedding_model is not None else existing.get("embedding_model"),
                embedding_dim if embedding_dim is not None else existing.get("embedding_dim"),
                memory_id,
            ),
        )

        # Audit event
        conn.execute(
            """
            INSERT INTO memory_events(
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, 'update', ?, ?, ?)
            """,
            (
                new_id(),
                memory_id,
                existing["origin_branch_id"],
                actor,
                json.dumps({"content": existing["content"], "version": current_version}),
                json.dumps({"content": new_content, "version": new_version}),
                now,
            ),
        )

        # Outbox event
        conn.execute(
            """
            INSERT INTO outbox_events(id, memory_id, op, payload_json, status, attempts, created_at)
            VALUES (?, ?, 'upsert', ?, 'pending', 0, ?)
            """,
            (
                new_id(),
                memory_id,
                json.dumps({
                    "id": memory_id,
                    "space_id": existing["space_id"],
                    "branch_id": existing["origin_branch_id"],
                    "content": new_content,
                    "kind": new_kind,
                }),
                now,
            ),
        )

        if commit:
            conn.commit()

        updated = MemoryService.get(conn, memory_id)
        assert updated is not None
        return updated

    @staticmethod
    def undo_memory(
        conn: Any,
        memory_id: str,
        *,
        actor: str = "user",
        commit: bool = True,
    ) -> dict[str, Any]:
        existing = MemoryService.get(conn, memory_id)
        if existing is None:
            raise not_found()

        # Find latest archived version
        prior = conn.execute(
            """
            SELECT * FROM memory_versions
            WHERE memory_id = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (memory_id,),
        ).fetchone()

        if prior is None:
            raise ApiError(400, "cannot_undo", "No prior version available to restore")

        prior_content = prior["content"]
        prior_kind = prior["kind"] or existing["kind"]
        now = utc_now()
        new_version = existing.get("version", 1) + 1

        conn.execute(
            """
            UPDATE memories
            SET content = ?, kind = ?, version = ?, content_hash = ?, index_state = 'pending'
            WHERE id = ?
            """,
            (prior_content, prior_kind, new_version, content_hash(prior_content), memory_id),
        )

        # Delete restored version row from versions
        conn.execute("DELETE FROM memory_versions WHERE id = ?", (prior["id"],))

        # Audit event
        conn.execute(
            """
            INSERT INTO memory_events(
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, 'undo', ?, ?, ?)
            """,
            (
                new_id(),
                memory_id,
                existing["origin_branch_id"],
                actor,
                json.dumps({"content": existing["content"]}),
                json.dumps({"content": prior_content, "restored_version": prior["version"]}),
                now,
            ),
        )

        if commit:
            conn.commit()

        restored = MemoryService.get(conn, memory_id)
        assert restored is not None
        return restored

    @staticmethod
    def tombstone_memory(
        conn: Any,
        memory_id: str,
        *,
        branch_id: str,
        actor: str = "user",
        commit: bool = True,
    ) -> None:
        existing = MemoryService.get(conn, memory_id)
        if existing is None:
            raise not_found()

        now = utc_now()
        conn.execute(
            "UPDATE memories SET status = 'tombstoned', deleted_at = ? WHERE id = ?",
            (now, memory_id),
        )

        conn.execute(
            """
            INSERT INTO memory_events(
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, 'delete', ?, NULL, ?)
            """,
            (
                new_id(),
                memory_id,
                branch_id,
                actor,
                json.dumps({"status": existing.get("status")}),
                now,
            ),
        )

        conn.execute(
            """
            INSERT INTO outbox_events(id, memory_id, op, payload_json, status, attempts, created_at)
            VALUES (?, ?, 'delete', ?, 'pending', 0, ?)
            """,
            (new_id(), memory_id, json.dumps({"id": memory_id}), now),
        )

        if commit:
            conn.commit()

    @staticmethod
    def set_override(
        conn: Any,
        branch_id: str,
        memory_id: str,
        *,
        excluded: int | None = None,
        pinned: int | None = None,
        content_override: str | None = None,
        clear_excluded: bool = False,
        clear_pinned: bool = False,
        clear_content: bool = False,
        actor: str = "user",
        commit: bool = True,
    ) -> None:
        existing = conn.execute(
            "SELECT * FROM memory_overrides WHERE branch_id = ? AND memory_id = ?",
            (branch_id, memory_id),
        ).fetchone()
        now = utc_now()
        if existing is None:
            conn.execute(
                """
                INSERT INTO memory_overrides(
                    branch_id, memory_id, excluded, pinned, content_override, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (branch_id, memory_id, excluded, pinned, content_override, now),
            )
        else:
            new_ex = (
                None
                if clear_excluded
                else (excluded if excluded is not None else existing["excluded"])
            )
            new_pin = (
                None
                if clear_pinned
                else (pinned if pinned is not None else existing["pinned"])
            )
            new_cnt = (
                None
                if clear_content
                else (
                    content_override
                    if content_override is not None
                    else existing["content_override"]
                )
            )
            conn.execute(
                """
                UPDATE memory_overrides
                SET excluded = ?, pinned = ?, content_override = ?, updated_at = ?
                WHERE branch_id = ? AND memory_id = ?
                """,
                (new_ex, new_pin, new_cnt, now, branch_id, memory_id),
            )

        payload = {
            "excluded": excluded,
            "pinned": pinned,
            "content_override": content_override,
        }
        conn.execute(
            """
            INSERT INTO memory_events(
                id, memory_id, branch_id, actor, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, 'override', NULL, ?, ?)
            """,
            (new_id(), memory_id, branch_id, actor, json.dumps(payload), now),
        )

        if commit:
            conn.commit()

    @staticmethod
    def forget_memory(
        conn: Any,
        memory_id: str,
        *,
        propagate_derived: bool = False,
        actor: str = "user",
        commit: bool = True,
    ) -> dict[str, Any]:
        existing = MemoryService.get(conn, memory_id)
        if existing is None:
            raise not_found()

        target_ids = [memory_id]
        if propagate_derived:
            derived_rows = conn.execute(
                "SELECT id FROM memories WHERE derived_from_id = ?", (memory_id,)
            ).fetchall()
            target_ids.extend([r["id"] if isinstance(r, dict) else r[0] for r in derived_rows])

        now = utc_now()
        forgotten_count = 0

        for mid in target_ids:
            # 1. Delete overrides
            conn.execute("DELETE FROM memory_overrides WHERE memory_id = ?", (mid,))
            # 2. Delete version history
            conn.execute("DELETE FROM memory_versions WHERE memory_id = ?", (mid,))
            # 3. Delete proposals referencing this memory
            conn.execute(
                """
                DELETE FROM memory_proposals
                WHERE accepted_memory_id = ? OR conflicts_with_memory_id = ?
                """,
                (mid, mid),
            )
            # 4. Outbox delete event for Qdrant
            conn.execute(
                """
                INSERT INTO outbox_events(
                    id, memory_id, op, payload_json, status, attempts, created_at
                ) VALUES (?, ?, 'delete', ?, 'pending', 0, ?)
                """,
                (new_id(), mid, json.dumps({"id": mid}), now),
            )
            # 5. Non-content audit entry
            conn.execute(
                """
                INSERT INTO memory_events(
                    id, memory_id, branch_id, actor, action, before_json, after_json, created_at
                ) VALUES (?, ?, ?, ?, 'forget', NULL, NULL, ?)
                """,
                (new_id(), mid, existing["origin_branch_id"], actor, now),
            )
            # 6. Hard delete from memories table
            conn.execute("DELETE FROM memories WHERE id = ?", (mid,))
            forgotten_count += 1

        if commit:
            conn.commit()

        return {"forgotten_count": forgotten_count, "memory_id": memory_id}
