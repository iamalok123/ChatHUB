from __future__ import annotations

from pathlib import Path

import pytest

from app.db import Database
from app.engine.memory_service import MemoryService
from app.errors import ApiError


@pytest.fixture
def memory_db(tmp_path: Path):
    db_file = tmp_path / "mem_service.db"
    db = Database(db_file)
    db.initialize()
    conn = db.connect()
    try:
        # Seed user, space, branch, commit
        conn.execute(
            """
            INSERT INTO users (id, email, password_hash, display_name, created_at)
            VALUES ('u1', 'u@test.com', 'h', 'U', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO spaces (id, owner_id, name, created_at)
            VALUES ('s1', 'u1', 'S1', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO branches (id, space_id, name, created_at)
            VALUES ('b1', 's1', 'main', '2026-10-20T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO commits (id, space_id, branch_id, role, content, created_at)
            VALUES ('c1', 's1', 'b1', 'anchor', '', '2026-10-20T00:00:00Z')
            """
        )
        conn.commit()
        yield conn
    finally:
        conn.close()


def test_memory_service_lifecycle_create_and_update(memory_db):
    # 1. Create memory
    created = MemoryService.create_memory(
        memory_db,
        space_id="s1",
        origin_branch_id="b1",
        source_commit_id="c1",
        content="I prefer dark mode in all editors",
        kind="preference",
        subject_key="user.ui.theme",
    )
    mem_id = created["id"]
    assert created["version"] == 1
    assert created["status"] == "active"
    assert created["subject_key"] == "user.ui.theme"

    # Verify audit event and outbox event
    event = memory_db.execute(
        "SELECT * FROM memory_events WHERE memory_id = ? AND action = 'create'", (mem_id,)
    ).fetchone()
    assert event is not None

    outbox = memory_db.execute(
        "SELECT * FROM outbox_events WHERE memory_id = ? AND op = 'upsert'", (mem_id,)
    ).fetchone()
    assert outbox is not None

    # 2. Update memory
    updated = MemoryService.update_memory(
        memory_db,
        mem_id,
        content="I prefer OLED high contrast dark mode",
        expected_version=1,
    )
    assert updated["version"] == 2
    assert updated["content"] == "I prefer OLED high contrast dark mode"

    # Verify memory_versions archived v1
    v1_archive = memory_db.execute(
        "SELECT * FROM memory_versions WHERE memory_id = ? AND version = 1", (mem_id,)
    ).fetchone()
    assert v1_archive is not None
    assert v1_archive["content"] == "I prefer dark mode in all editors"

    # 3. Optimistic concurrency check
    with pytest.raises(ApiError) as exc_info:
        MemoryService.update_memory(
            memory_db,
            mem_id,
            content="Conflicting edit",
            expected_version=1,  # Stale version!
        )
    assert exc_info.value.status_code == 409


def test_memory_service_undo(memory_db):
    created = MemoryService.create_memory(
        memory_db,
        space_id="s1",
        origin_branch_id="b1",
        source_commit_id="c1",
        content="Initial fact",
    )
    mem_id = created["id"]

    MemoryService.update_memory(memory_db, mem_id, content="Edited fact")
    assert MemoryService.get(memory_db, mem_id)["content"] == "Edited fact"

    # Undo
    restored = MemoryService.undo_memory(memory_db, mem_id)
    assert restored["content"] == "Initial fact"
    assert restored["version"] == 3


def test_memory_service_tombstone_and_forget(memory_db):
    created = MemoryService.create_memory(
        memory_db,
        space_id="s1",
        origin_branch_id="b1",
        source_commit_id="c1",
        content="Secret to erase",
    )
    mem_id = created["id"]

    # Tombstone (soft delete)
    MemoryService.tombstone_memory(memory_db, mem_id, branch_id="b1")
    tombstoned = MemoryService.get(memory_db, mem_id)
    assert tombstoned["status"] == "tombstoned"
    assert tombstoned["deleted_at"] is not None

    # True Forget
    res = MemoryService.forget_memory(memory_db, mem_id)
    assert res["forgotten_count"] == 1
    assert MemoryService.get(memory_db, mem_id) is None

    # Verify non-content audit entry
    forget_event = memory_db.execute(
        "SELECT * FROM memory_events WHERE memory_id = ? AND action = 'forget'", (mem_id,)
    ).fetchone()
    assert forget_event is not None
    assert forget_event["before_json"] is None
    assert forget_event["after_json"] is None
