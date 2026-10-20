from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.engine.retrieval import retrieve_memories
from app.llm.embeddings import to_blob
from app.repo import memories as memories_repo
from tests.helpers import (
    REQUEST_HEADERS,
    create_space,
    fork,
    refresh_branch,
    signup,
    stream_chat,
)


def main_branch(client: TestClient, space_id: str) -> dict:
    response = client.get(f"/api/spaces/{space_id}/branches")
    assert response.status_code == 200
    return response.json()[0]


def connect(app):
    return app.state.database.connect()


def proposals_event(events: list[dict]) -> dict:
    return next(event["data"] for event in events if event["event"] == "proposals")


def extract_step(events: list[dict]) -> dict:
    steps = [
        event["data"]
        for event in events
        if event["event"] == "step" and event["data"]["phase"] == "extract"
    ]
    return steps[-1]


def test_manual_memory_crud_and_ownership(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    response = client.post(
        f"/api/branches/{main['id']}/memories",
        json={
            "content": "I live in Bhubaneswar.",
            "kind": "fact",
            "importance": 0.9,
        },
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 201, response.text
    memory = response.json()
    assert memory["content"] == "I live in Bhubaneswar."
    assert memory["kind"] == "fact"
    assert memory["importance"] == 0.9
    assert memory["origin_branch_name"] == "main"
    assert memory["inherited"] is False
    assert memory["excluded"] is False
    assert memory["has_embedding"] is True
    assert memory["stale_embedding"] is False
    assert memory["source_commit_id"] == main["head_commit_id"]

    listing = client.get(f"/api/branches/{main['id']}/memories").json()
    assert [item["id"] for item in listing["memories"]] == [memory["id"]]
    assert listing["excluded"] == []
    branch = client.get(f"/api/branches/{main['id']}").json()
    assert branch["memory_count"] == 1

    updated = client.patch(
        f"/api/branches/{main['id']}/memories/{memory['id']}",
        json={"content": "I live in Cuttack.", "importance": 0.8},
        headers=REQUEST_HEADERS,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["content"] == "I live in Cuttack."
    assert updated.json()["importance"] == 0.8
    assert updated.json()["has_embedding"] is True

    second_space = create_space(client, "Second space")
    second_main = main_branch(client, second_space["id"])
    hidden = client.post(
        f"/api/branches/{second_main['id']}/memories/{memory['id']}/override",
        json={"action": "exclude"},
        headers=REQUEST_HEADERS,
    )
    assert hidden.status_code == 404

    deleted = client.delete(
        f"/api/branches/{main['id']}/memories/{memory['id']}",
        headers=REQUEST_HEADERS,
    )
    assert deleted.status_code == 204
    assert client.get(f"/api/branches/{main['id']}/memories").json()["memories"] == []

    client.post("/api/auth/logout", headers=REQUEST_HEADERS)
    signup(client, email="other@example.com")
    assert client.get(f"/api/branches/{main['id']}/memories").status_code == 404
    assert client.get(f"/api/branches/{main['id']}/proposals").status_code == 404


def test_fork_overrides_are_branch_local_and_do_not_leak(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    status, _events = stream_chat(client, main["id"], "Opening context.")
    assert status == 200
    conn = connect(app)
    try:
        main = refresh_branch(conn, main["id"])
    finally:
        conn.close()

    created = client.post(
        f"/api/branches/{main['id']}/memories",
        json={"content": "I prefer tea.", "kind": "preference", "importance": 0.9},
        headers=REQUEST_HEADERS,
    )
    assert created.status_code == 201, created.text
    memory = created.json()

    conn = connect(app)
    try:
        child = fork(conn, main["id"], main["head_commit_id"], "Tea branch")
    finally:
        conn.close()

    child_list = client.get(f"/api/branches/{child['id']}/memories").json()
    assert len(child_list["memories"]) == 1
    inherited = child_list["memories"][0]
    assert inherited["inherited"] is True
    assert inherited["origin_branch_name"] == "main"

    assert (
        client.patch(
            f"/api/branches/{child['id']}/memories/{memory['id']}",
            json={"content": "Changed upstream"},
            headers=REQUEST_HEADERS,
        ).status_code
        == 403
    )

    excluded = client.post(
        f"/api/branches/{child['id']}/memories/{memory['id']}/override",
        json={"action": "exclude"},
        headers=REQUEST_HEADERS,
    )
    assert excluded.status_code == 200
    assert excluded.json()["excluded"] is True
    child_list = client.get(f"/api/branches/{child['id']}/memories").json()
    assert child_list["memories"] == []
    assert [item["id"] for item in child_list["excluded"]] == [memory["id"]]

    assert (
        client.get(f"/api/branches/{main['id']}/memories").json()["memories"][0]["content"]
        == "I prefer tea."
    )

    status, events = stream_chat(client, child["id"], "What do I prefer?")
    assert status == 200
    done = next(event["data"] for event in events if event["event"] == "done")
    trace = client.get(
        f"/api/branches/{child['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["retrieved_memories"] == []
    assert [item["id"] for item in trace["excluded_memories"]] == [memory["id"]]
    assert trace["context"]["memory_count"] == 0

    included = client.post(
        f"/api/branches/{child['id']}/memories/{memory['id']}/override",
        json={"action": "include"},
        headers=REQUEST_HEADERS,
    )
    assert included.status_code == 200
    pinned = client.post(
        f"/api/branches/{child['id']}/memories/{memory['id']}/override",
        json={"action": "pin"},
        headers=REQUEST_HEADERS,
    )
    assert pinned.status_code == 200
    assert pinned.json()["pinned"] is True

    edited = client.post(
        f"/api/branches/{child['id']}/memories/{memory['id']}/override",
        json={"action": "edit", "content": "I prefer strong tea."},
        headers=REQUEST_HEADERS,
    )
    assert edited.status_code == 200
    assert edited.json()["content"] == "I prefer strong tea."
    assert edited.json()["edited"] is True
    main_items = client.get(f"/api/branches/{main['id']}/memories").json()["memories"]
    assert main_items[0]["content"] == "I prefer tea."
    assert main_items[0]["edited"] is False

    child_memory = client.post(
        f"/api/branches/{child['id']}/memories",
        json={"content": "A child-only fact.", "kind": "fact"},
        headers=REQUEST_HEADERS,
    )
    assert child_memory.status_code == 201
    hidden = client.post(
        f"/api/branches/{main['id']}/memories/{child_memory.json()['id']}/override",
        json={"action": "exclude"},
        headers=REQUEST_HEADERS,
    )
    assert hidden.status_code == 404
    assert (
        client.get(f"/api/branches/{main['id']}/memories").json()["memories"][0]["id"]
        == memory["id"]
    )


def test_review_proposals_accept_reject_and_next_turn_retrieval(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    status, events = stream_chat(
        client,
        main["id"],
        "I prefer short answers and I live in Bhubaneswar.",
    )
    assert status == 200
    state = proposals_event(events)
    assert state["mode"] == "review"
    assert state["auto_saved"] == []
    assert len(state["proposals"]) == 2
    assert extract_step(events)["status"] == "done"

    done = next(event["data"] for event in events if event["event"] == "done")
    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["retrieved_memories"] == []
    assert trace["extraction"]["proposals"] == 2
    assert len(trace["memory_operations"]) == 2
    assert trace["context"]["memory_count"] == 0
    assert trace["retrieval"]["top_k"] == 6

    proposals = client.get(f"/api/branches/{main['id']}/proposals").json()
    assert len(proposals) == 2
    preference = next(item for item in proposals if item["kind"] == "preference")
    fact = next(item for item in proposals if item["kind"] == "fact")

    accepted = client.post(
        f"/api/branches/{main['id']}/proposals/{preference['id']}/accept",
        json={"content": "I prefer concise answers."},
        headers=REQUEST_HEADERS,
    )
    assert accepted.status_code == 200, accepted.text
    accepted_body = accepted.json()
    assert accepted_body["proposal"]["status"] == "accepted"
    assert accepted_body["memory"]["content"] == "I prefer concise answers."
    assert accepted_body["memory"]["origin_branch_id"] == main["id"]

    rejected = client.post(
        f"/api/branches/{main['id']}/proposals/{fact['id']}/reject",
        headers=REQUEST_HEADERS,
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert client.get(f"/api/branches/{main['id']}/proposals").json() == []

    status, events = stream_chat(client, main["id"], "Can you help me plan my week?")
    assert status == 200
    done = next(event["data"] for event in events if event["event"] == "done")
    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    retrieved = trace["retrieved_memories"]
    assert [item["id"] for item in retrieved] == [accepted_body["memory"]["id"]]
    assert retrieved[0]["importance_score"] == 0.7
    assert retrieved[0]["similarity"] is not None
    assert retrieved[0]["score"] is not None
    assert retrieved[0]["recency"] > 0
    assert trace["context"]["memory_count"] == 1
    assert trace["excluded_memories"] == []


def test_proposal_can_only_be_resolved_once(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    _status, events = stream_chat(client, main["id"], "I prefer short answers.")
    proposal = proposals_event(events)["proposals"][0]
    first = client.post(
        f"/api/branches/{main['id']}/proposals/{proposal['id']}/accept",
        json={},
        headers=REQUEST_HEADERS,
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/branches/{main['id']}/proposals/{proposal['id']}/accept",
        json={},
        headers=REQUEST_HEADERS,
    )
    assert second.status_code == 409
    rejected = client.post(
        f"/api/branches/{main['id']}/proposals/{proposal['id']}/reject",
        headers=REQUEST_HEADERS,
    )
    assert rejected.status_code == 409
    assert len(client.get(f"/api/branches/{main['id']}/memories").json()["memories"]) == 1


def test_conflicting_proposal_can_replace_the_old_memory(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    _status, events = stream_chat(client, main["id"], "I prefer short answers.")
    proposal = proposals_event(events)["proposals"][0]
    accepted = client.post(
        f"/api/branches/{main['id']}/proposals/{proposal['id']}/accept",
        json={},
        headers=REQUEST_HEADERS,
    )
    old_memory = accepted.json()["memory"]
    assert old_memory["supersedes_id"] is None

    _status, events = stream_chat(client, main["id"], "I prefer very short answers.")
    conflict = proposals_event(events)["proposals"]
    assert len(conflict) == 1
    assert conflict[0]["conflicts_with_memory_id"] == old_memory["id"]
    assert conflict[0]["conflict_content"] == "I prefer short answers."

    replaced = client.post(
        f"/api/branches/{main['id']}/proposals/{conflict[0]['id']}/accept",
        json={"resolution": "replace"},
        headers=REQUEST_HEADERS,
    )
    assert replaced.status_code == 200, replaced.text
    body = replaced.json()
    assert body["proposal"]["resolution"] == "replace"
    assert body["memory"]["supersedes_id"] == old_memory["id"]
    assert body["memory"]["id"] != old_memory["id"]

    items = client.get(f"/api/branches/{main['id']}/memories").json()
    assert [item["id"] for item in items["memories"]] == [body["memory"]["id"]]
    assert items["excluded"] == []

    conn = connect(app)
    try:
        old_row = memories_repo.get(conn, old_memory["id"])
    finally:
        conn.close()
    assert old_row is not None
    assert old_row["deleted_at"] is None


def test_conflicting_proposal_can_keep_both_memories(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    _status, events = stream_chat(client, main["id"], "I prefer short answers.")
    proposal = proposals_event(events)["proposals"][0]
    accepted = client.post(
        f"/api/branches/{main['id']}/proposals/{proposal['id']}/accept",
        json={},
        headers=REQUEST_HEADERS,
    )
    old_memory = accepted.json()["memory"]

    _status, events = stream_chat(client, main["id"], "I prefer very short answers.")
    conflict = proposals_event(events)["proposals"][0]
    kept = client.post(
        f"/api/branches/{main['id']}/proposals/{conflict['id']}/accept",
        json={"resolution": "keep_both"},
        headers=REQUEST_HEADERS,
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["memory"]["supersedes_id"] is None
    items = client.get(f"/api/branches/{main['id']}/memories").json()["memories"]
    assert {item["id"] for item in items} == {
        old_memory["id"],
        kept.json()["memory"]["id"],
    }


def test_auto_mode_saves_memories_and_proposes_conflicts(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    settings = client.patch(
        f"/api/branches/{main['id']}",
        json={"memory_mode": "auto"},
        headers=REQUEST_HEADERS,
    )
    assert settings.status_code == 200
    assert settings.json()["memory_mode"] == "auto"

    status, events = stream_chat(
        client, main["id"], "I prefer short answers and I live in Cuttack."
    )
    assert status == 200
    state = proposals_event(events)
    assert state["mode"] == "auto"
    assert len(state["auto_saved"]) == 2
    assert state["proposals"] == []
    items = client.get(f"/api/branches/{main['id']}/memories").json()["memories"]
    assert len(items) == 2

    done = next(event["data"] for event in events if event["event"] == "done")
    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["extraction"]["auto_saved"] == 2
    assert len(trace["memory_operations"]) == 2

    _status, events = stream_chat(client, main["id"], "I prefer very short answers.")
    state = proposals_event(events)
    assert state["auto_saved"] == []
    assert len(state["proposals"]) == 1
    conflict = state["proposals"][0]
    saved_preference = next(item for item in items if item["kind"] == "preference")
    assert conflict["conflicts_with_memory_id"] == saved_preference["id"]

    _status, events = stream_chat(
        client, main["id"], "I prefer short answers and I live in Cuttack."
    )
    assert all(event["event"] != "proposals" for event in events)
    done = next(event["data"] for event in events if event["event"] == "done")
    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert all(operation["op"] == "duplicate_skipped" for operation in trace["memory_operations"])
    assert len(client.get(f"/api/branches/{main['id']}/memories").json()["memories"]) == 2
    assert len(client.get(f"/api/branches/{main['id']}/proposals").json()) == 1


def test_off_mode_skips_extraction_entirely(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    settings = client.patch(
        f"/api/branches/{main['id']}",
        json={"memory_mode": "off"},
        headers=REQUEST_HEADERS,
    )
    assert settings.status_code == 200

    status, events = stream_chat(client, main["id"], "I prefer tea.")
    assert status == 200
    assert all(event["event"] != "proposals" for event in events)
    assert extract_step(events)["status"] == "skipped"
    done = next(event["data"] for event in events if event["event"] == "done")
    assert done["status"] == "complete"
    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["memory_mode"] == "off"
    assert trace["extraction"]["status"] == "skipped"
    assert trace["memory_operations"] == [{"op": "extraction_skipped", "reason": "memory_mode=off"}]
    assert client.get(f"/api/branches/{main['id']}/memories").json()["memories"] == []
    assert client.get(f"/api/branches/{main['id']}/proposals").json() == []


def test_extraction_failure_does_not_fail_chat(client, app, monkeypatch):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    async def fail(**_kwargs):
        raise RuntimeError("extractor unavailable")

    monkeypatch.setattr(app.state.provider, "extract_memories", fail)
    status, events = stream_chat(client, main["id"], "I prefer tea.")
    assert status == 200
    done = next(event["data"] for event in events if event["event"] == "done")
    assert done["status"] == "complete"
    assert all(event["event"] != "proposals" for event in events)
    assert extract_step(events)["status"] == "error"

    trace = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["extraction"]["status"] == "error"
    assert trace["memory_operations"][0]["op"] == "extraction_error"
    assert any("Memory extraction failed" in item for item in trace["warnings"])
    assert client.get(f"/api/branches/{main['id']}/memories").json()["memories"] == []


@pytest.mark.asyncio
async def test_retrieval_scores_pinned_stale_and_excluded_memories(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    conn = connect(app)
    provider = app.state.provider
    try:
        branch = refresh_branch(conn, main["id"])
        source_id = branch["head_commit_id"]

        async def create_memory(
            content: str,
            *,
            kind: str = "fact",
            importance: float = 0.5,
            model: str | None = None,
        ):
            vector = (await provider.embed([content], task_type="RETRIEVAL_DOCUMENT"))[0]
            return memories_repo.create(
                conn,
                space_id=branch["space_id"],
                origin_branch_id=branch["id"],
                source_commit_id=source_id,
                content=content,
                kind=kind,
                importance=importance,
                embedding=to_blob(vector),
                embedding_model=model or provider.embed_model,
                embedding_dim=provider.embed_dim,
            )

        relevant = await create_memory("I live in Bhubaneswar.", importance=0.9)
        stale = await create_memory(
            "I prefer morning runs.", kind="preference", model="old-embedding-model"
        )
        missing = await create_memory("I have a bicycle.")
        conn.execute(
            "UPDATE memories SET embedding = NULL, embedding_model = NULL, "
            "embedding_dim = NULL WHERE id = ?",
            (missing["id"],),
        )
        conn.commit()
        excluded = await create_memory("I hate loud alarms.", kind="preference")
        memories_repo.set_override(conn, branch["id"], excluded["id"], excluded=1)

        result = await retrieve_memories(
            conn,
            branch,
            user_text="Do I live in Bhubaneswar?",
            previous_assistant_text=None,
            provider=provider,
            top_k=6,
            memory_budget=800,
        )
        assert [item["id"] for item in result.selected] == [relevant["id"]]
        detail = result.selected_details[0]
        assert detail["reason"].startswith("high similarity")
        assert detail["similarity"] is not None and detail["similarity"] > 0.75
        assert detail["importance_score"] == 0.9
        assert detail["score"] is not None and detail["score"] > 0.5
        assert [item["id"] for item in result.excluded] == [excluded["id"]]
        reasons = {item["id"]: item["reason"] for item in result.considered}
        assert reasons[stale["id"]] == "stale embedding"
        assert reasons[missing["id"]] == "stale embedding"
        assert any("stale or missing embeddings" in item for item in result.warnings)

        memories_repo.set_override(conn, branch["id"], stale["id"], pinned=1)
        pinned_result = await retrieve_memories(
            conn,
            branch,
            user_text="Do I live in Bhubaneswar?",
            previous_assistant_text=None,
            provider=provider,
            top_k=6,
            memory_budget=1,
        )
        assert [item["id"] for item in pinned_result.selected] == [stale["id"]]
        assert pinned_result.selected_details[0]["reason"] == "pinned"
        assert pinned_result.used_tokens > 1
        assert any("exceeded" in item for item in pinned_result.warnings)
        skipped = {item["id"]: item["reason"] for item in pinned_result.considered}
        assert skipped[relevant["id"]] == "skipped for memory budget"

        listing = client.get(f"/api/branches/{branch['id']}/memories").json()
        by_id = {item["id"]: item for item in listing["memories"]}
        assert by_id[relevant["id"]]["stale_embedding"] is False
        assert by_id[stale["id"]]["stale_embedding"] is True
        assert by_id[missing["id"]]["stale_embedding"] is True
        assert by_id[missing["id"]]["has_embedding"] is False
        assert listing["excluded"][0]["id"] == excluded["id"]
    finally:
        conn.close()
