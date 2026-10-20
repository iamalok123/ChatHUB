from __future__ import annotations

import json

from starlette.testclient import TestClient

from app.config import REQUEST_HEADER
from app.engine.outbox import OutboxProcessor


def test_outbox_event_created_and_processed(client: TestClient):
    signup_res = client.post(
        "/api/auth/signup",
        json={
            "email": "outbox@example.com",
            "display_name": "Outbox User",
            "password": "password123",
        },
        headers={REQUEST_HEADER: "1"},
    )
    assert signup_res.status_code == 201

    space_res = client.post(
        "/api/spaces",
        json={"name": "Outbox Space"},
        headers={REQUEST_HEADER: "1"},
    )
    assert space_res.status_code == 201
    space_id = space_res.json()["id"]

    branch_id = client.get(f"/api/spaces/{space_id}/branches").json()[0]["id"]

    # Create memory
    mem_res = client.post(
        f"/api/branches/{branch_id}/memories",
        json={"content": "Outbox test item for sync", "kind": "fact"},
        headers={REQUEST_HEADER: "1"},
    )
    assert mem_res.status_code == 201
    mem_id = mem_res.json()["id"]

    # Verify outbox event exists in pending state
    db = client.app.state.database
    conn = db.connect()
    try:
        event = conn.execute(
            "SELECT * FROM outbox_events WHERE memory_id = ? AND op = 'upsert'",
            (mem_id,),
        ).fetchone()
        assert event is not None
        assert event["status"] == "pending"
        assert event["attempts"] == 0
        payload = json.loads(event["payload_json"])
        assert payload["id"] == mem_id
    finally:
        conn.close()

    # Process outbox
    qdrant = getattr(client.app.state, "qdrant", None)
    processed = OutboxProcessor.process_batch(db, qdrant)
    assert processed >= 1

    # Verify status changed to completed
    conn = db.connect()
    try:
        updated_event = conn.execute(
            "SELECT * FROM outbox_events WHERE memory_id = ? AND op = 'upsert'",
            (mem_id,),
        ).fetchone()
        assert updated_event is not None
        assert updated_event["status"] == "completed"
        assert updated_event["processed_at"] is not None
    finally:
        conn.close()
