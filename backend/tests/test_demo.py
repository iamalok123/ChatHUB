from __future__ import annotations

from fastapi.testclient import TestClient

from tests.helpers import REQUEST_HEADERS, signup


def _demo(client: TestClient) -> dict:
    response = client.post("/api/demo-space", headers=REQUEST_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def _branches(client: TestClient, space_id: str) -> dict[str, dict]:
    response = client.get(f"/api/spaces/{space_id}/branches")
    assert response.status_code == 200, response.text
    return {branch["name"]: branch for branch in response.json()}


def _memories(client: TestClient, branch_id: str) -> dict:
    response = client.get(f"/api/branches/{branch_id}/memories")
    assert response.status_code == 200, response.text
    return response.json()


def _messages(client: TestClient, branch_id: str) -> list[dict]:
    response = client.get(f"/api/branches/{branch_id}/messages")
    assert response.status_code == 200, response.text
    return response.json()


def _contents(payload: dict) -> set[str]:
    return {item["content"] for item in payload["memories"]}


def test_demo_space_seeds_branches_memories_trace_and_proposal(
    client: TestClient,
) -> None:
    signup(client)
    space = _demo(client)

    branches = _branches(client, space["id"])
    assert set(branches) == {"main", "typescript-examples", "minimal-ui"}
    main = branches["main"]
    examples = branches["typescript-examples"]
    minimal = branches["minimal-ui"]
    assert main["is_root"] is True
    assert examples["parent_branch_id"] == main["id"]
    assert minimal["parent_branch_id"] == main["id"]
    assert examples["fork_commit_id"] != minimal["fork_commit_id"]
    assert main["message_count"] == 6
    assert examples["message_count"] == 8
    assert minimal["message_count"] == 6
    assert main["memory_count"] == 5
    assert examples["memory_count"] == 4
    assert minimal["memory_count"] == 3

    main_memories = _contents(_memories(client, main["id"]))
    examples_memories = _contents(_memories(client, examples["id"]))
    minimal_payload = _memories(client, minimal["id"])
    minimal_memories = _contents(minimal_payload)

    indexeddb = "The user wants IndexedDB examples for offline reading."
    simple_stack = "The stack should stay simple: React, TypeScript, and local storage."
    assert indexeddb in main_memories
    assert indexeddb in examples_memories
    assert indexeddb not in minimal_memories
    assert simple_stack in main_memories
    assert simple_stack not in examples_memories
    assert simple_stack not in minimal_memories
    assert simple_stack in {item["content"] for item in minimal_payload["excluded"]}
    assert all(item["has_embedding"] for item in _memories(client, main["id"])["memories"])

    messages = _messages(client, minimal["id"])
    inherited = [item for item in messages if item["is_inherited"]]
    assert len(inherited) == 4
    assert all(item["origin_branch_name"] == "main" for item in inherited)

    proposals = client.get(f"/api/branches/{minimal['id']}/proposals")
    assert proposals.status_code == 200, proposals.text
    assert len(proposals.json()) == 1
    assert proposals.json()[0]["status"] == "pending"
    assert "minimal reading view" in proposals.json()[0]["content"]

    graph = client.get(f"/api/spaces/{space['id']}/graph")
    assert graph.status_code == 200, graph.text
    payload = graph.json()
    assert {edge["kind"] for edge in payload["edges"]} == {"fork", "merge"}
    assert sum(edge["kind"] == "fork" for edge in payload["edges"]) == 2
    assert [item["name"] for item in payload["checkpoints"]] == ["Baseline before experiments"]

    latest = messages[-1]
    trace = client.get(f"/api/branches/{minimal['id']}/messages/{latest['id']}/trace")
    assert trace.status_code == 200, trace.text
    body = trace.json()["trace"]
    assert body["provider"] == "demo"
    assert body["demo"] is True
    assert body["mock"] is False
    assert body["thinking_source"] == "synthetic_context"
    assert body["status"] == "complete"
    assert body["retrieved_memories"]
    assert all(item["score"] is not None for item in body["retrieved_memories"])
    assert body["context"]["memory_count"] == len(body["retrieved_memories"])

    sync = client.get(f"/api/branches/{minimal['id']}/sync-preview")
    assert sync.status_code == 200, sync.text
    assert indexeddb in {item["content"] for item in sync.json()["memories"]}


def test_demo_space_is_owned_by_the_authenticated_user(client: TestClient) -> None:
    signup(client)
    space = _demo(client)

    signup(
        client,
        email="grace@example.com",
        password="another correct horse",
        display_name="Grace",
    )
    foreign = client.get(f"/api/spaces/{space['id']}")
    assert foreign.status_code == 404
    assert client.get(f"/api/spaces/{space['id']}/branches").status_code == 404

    second = _demo(client)
    assert second["id"] != space["id"]
    spaces = client.get("/api/spaces")
    assert spaces.status_code == 200
    assert {item["id"] for item in spaces.json()} == {second["id"]}
