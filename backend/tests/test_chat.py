from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.engine.chat import ChatStreamer
from app.engine.context import compose_context
from app.repo import branches, commits
from app.visibility import visible_messages
from tests.helpers import (
    REQUEST_HEADERS,
    create_space,
    fork,
    signup,
    stream_chat,
    stream_regenerate,
)


def main_branch(client: TestClient, space_id: str) -> dict:
    response = client.get(f"/api/spaces/{space_id}/branches")
    assert response.status_code == 200
    return response.json()[0]


def connect(app):
    return app.state.database.connect()


def test_chat_streams_persists_and_traces(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    head = main["head_commit_id"]

    status, events = stream_chat(
        client, main["id"], "I prefer short answers.", expected_head_id=head
    )
    assert status == 200
    names = [event["event"] for event in events]
    assert "token" in names
    assert "thinking" in names
    assert "done" in names
    assert "error" not in names
    assert names.count("step") >= 4

    tokens = "".join(
        event["data"]["text"] for event in events if event["event"] == "token"
    )
    assert tokens.startswith("[Mock mode]")
    done = next(event["data"] for event in events if event["event"] == "done")
    assert done["status"] == "complete"
    assert done["provider"] == "mock"
    assert done["user_commit_id"]
    assert done["assistant_commit_id"]
    assert done["trace_version"] == 1

    messages = client.get(f"/api/branches/{main['id']}/messages").json()
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "I prefer short answers."
    assert messages[1]["content"] == tokens
    assert messages[1]["id"] == done["assistant_commit_id"]
    assert messages[1]["status"] == "complete"
    assert messages[1]["is_inherited"] is False
    assert messages[1]["origin_branch_name"] == "main"

    branch = client.get(f"/api/branches/{main['id']}").json()
    assert branch["head_commit_id"] == done["assistant_commit_id"]
    assert branch["message_count"] == 2

    trace_response = client.get(
        f"/api/branches/{main['id']}/messages/{done['assistant_commit_id']}/trace"
    )
    assert trace_response.status_code == 200
    trace = trace_response.json()
    assert trace["trace_version"] == 1
    body = trace["trace"]
    assert body["provider"] == "mock"
    assert body["mock"] is True
    assert body["status"] == "complete"
    assert body["thinking_source"] == "model"
    assert "mock" in body["thinking_summary"].lower()
    assert body["context"]["history_messages"] == 0
    assert body["context"]["total_tokens"] > 0
    assert body["usage"]["total_token_count"] > 0
    assert body["retrieved_memories"] == []


def test_second_chat_uses_the_first_turn_as_history(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    first_status, first_events = stream_chat(client, main["id"], "First question")
    assert first_status == 200
    first_done = next(
        event["data"] for event in first_events if event["event"] == "done"
    )

    second_status, second_events = stream_chat(
        client,
        main["id"],
        "Second question",
        expected_head_id=first_done["assistant_commit_id"],
    )
    assert second_status == 200
    second_done = next(
        event["data"] for event in second_events if event["event"] == "done"
    )
    assert second_done["user_commit_id"] != first_done["user_commit_id"]

    messages = client.get(f"/api/branches/{main['id']}/messages").json()
    assert [message["role"] for message in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert messages[2]["content"] == "Second question"

    trace = client.get(
        f"/api/branches/{main['id']}/messages/{second_done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["context"]["history_messages"] == 2
    assert trace["context"]["history_tokens"] > 0


def test_chat_rejects_stale_head_without_persisting(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    status, events = stream_chat(
        client, main["id"], "Never saved", expected_head_id="stale-head"
    )
    assert status == 409
    assert events == []
    error = client.post(
        f"/api/branches/{main['id']}/chat",
        json={"message": "Never saved", "expected_head_id": "stale-head"},
        headers=REQUEST_HEADERS,
    )
    assert error.status_code == 409
    assert error.json()["error"]["code"] == "head_conflict"
    assert client.get(f"/api/branches/{main['id']}/messages").json() == []

    conn = connect(app)
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM commits WHERE branch_id = ?", (main["id"],)
        ).fetchone()[0]
    finally:
        conn.close()
    assert count == 1


def test_chat_is_scoped_to_owner(client):
    signup(client, email="owner@example.com")
    space = create_space(client)
    main = main_branch(client, space["id"])
    client.post("/api/auth/logout", headers=REQUEST_HEADERS)

    signup(client, email="other@example.com")
    status, events = stream_chat(client, main["id"], "Trying to intrude")
    assert status == 404
    assert events == []


def test_sibling_chat_and_traces_are_isolated(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    status, events = stream_chat(client, main["id"], "Shared opening")
    assert status == 200
    main_assistant = next(
        event["data"]["assistant_commit_id"]
        for event in events
        if event["event"] == "done"
    )

    conn = connect(app)
    try:
        child = fork(
            conn, main["id"], main_assistant, "Child"
        )
    finally:
        conn.close()

    status, events = stream_chat(client, child["id"], "Only on the child")
    assert status == 200
    child_assistant = next(
        event["data"]["assistant_commit_id"]
        for event in events
        if event["event"] == "done"
    )

    child_messages = client.get(f"/api/branches/{child['id']}/messages").json()
    main_messages = client.get(f"/api/branches/{main['id']}/messages").json()
    assert len(child_messages) == 4
    assert len(main_messages) == 2
    assert child_messages[0]["is_inherited"] is True
    assert child_messages[0]["origin_branch_name"] == "main"
    assert child_messages[2]["is_inherited"] is False
    assert "Only on the child" not in {
        message["content"] for message in main_messages
    }

    inherited_trace = client.get(
        f"/api/branches/{child['id']}/messages/{main_assistant}/trace"
    )
    assert inherited_trace.status_code == 200
    hidden_trace = client.get(
        f"/api/branches/{main['id']}/messages/{child_assistant}/trace"
    )
    assert hidden_trace.status_code == 404


def test_regenerate_creates_sibling_without_copying_user_message(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    status, _events = stream_chat(client, main["id"], "Original question")
    assert status == 200
    original = client.get(f"/api/branches/{main['id']}/messages").json()
    user_message, assistant_message = original

    status, events = stream_regenerate(client, main["id"], assistant_message["id"])
    assert status == 200
    assert events[0]["event"] == "branch"
    branch_event = events[0]["data"]
    new_branch_id = branch_event["branch_id"]
    assert branch_event["fork_commit_id"] == user_message["id"]
    assert branch_event["parent_branch_id"] == main["id"]

    tokens = "".join(
        event["data"]["text"] for event in events if event["event"] == "token"
    )
    done = next(event["data"] for event in events if event["event"] == "done")
    assert tokens.startswith("[Mock mode]")
    assert done["status"] == "complete"

    regenerated = client.get(f"/api/branches/{new_branch_id}/messages").json()
    assert [message["role"] for message in regenerated] == ["user", "assistant"]
    assert regenerated[0]["id"] == user_message["id"]
    assert regenerated[1]["id"] == done["assistant_commit_id"]
    assert regenerated[0]["id"] != regenerated[1]["id"]

    original_after = client.get(f"/api/branches/{main['id']}/messages").json()
    assert [message["id"] for message in original_after] == [
        user_message["id"],
        assistant_message["id"],
    ]

    conn = connect(app)
    try:
        branch_row = conn.execute(
            "SELECT * FROM branches WHERE id = ?", (new_branch_id,)
        ).fetchone()
        user_count = conn.execute(
            "SELECT COUNT(*) FROM commits WHERE content = ?", ("Original question",)
        ).fetchone()[0]
    finally:
        conn.close()
    assert branch_row is not None
    assert branch_row["parent_branch_id"] == main["id"]
    assert branch_row["fork_commit_id"] == user_message["id"]
    assert user_count == 1

    trace = client.get(
        f"/api/branches/{new_branch_id}/messages/{done['assistant_commit_id']}/trace"
    ).json()["trace"]
    assert trace["regenerated_from"] == assistant_message["id"]
    assert trace["current_user_commit_id"] == user_message["id"]


def test_regenerate_rejects_non_assistant_target(client):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])
    status, _events = stream_chat(client, main["id"], "Question")
    assert status == 200
    messages = client.get(f"/api/branches/{main['id']}/messages").json()

    response = client.post(
        f"/api/branches/{main['id']}/regenerate/{messages[0]['id']}",
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_target"


@pytest.mark.asyncio
async def test_closing_stream_persists_partial_reply(client, app):
    user = signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    conn = connect(app)
    try:
        branch = branches.require_owned(conn, main["id"], user.id)
        space_row = conn.execute(
            "SELECT * FROM spaces WHERE id = ?", (space["id"],)
        ).fetchone()
        assert space_row is not None
        history = visible_messages(conn, branch)
        user_commit = commits.append_at_head(
            conn,
            space_id=space["id"],
            branch_id=branch["id"],
            expected_head_id=branch["head_commit_id"],
            role="user",
            content="Please write a longer answer",
        )
        assistant_commit = commits.append_at_head(
            conn,
            space_id=space["id"],
            branch_id=branch["id"],
            expected_head_id=user_commit["id"],
            role="assistant",
            content="",
            status="streaming",
        )
        context = compose_context(
            space=space_row,
            branch=branch,
            history=history,
            current_user_text=user_commit["content"],
            memories=[],
            history_budget=3000,
            memory_budget=800,
        )
    finally:
        conn.close()

    streamer = ChatStreamer(
        database=app.state.database,
        provider=app.state.provider,
        settings=app.state.settings,
        branch=branch,
        space=space_row,
        context=context,
        assistant_commit_id=assistant_commit["id"],
        current_user_commit_id=user_commit["id"],
        initial_steps=[],
    )
    generator = streamer.stream()
    try:
        while True:
            chunk = await anext(generator)
            if chunk.startswith("event: token"):
                break
    finally:
        await generator.aclose()

    conn = connect(app)
    try:
        saved = commits.get(conn, assistant_commit["id"])
        current_branch = conn.execute(
            "SELECT * FROM branches WHERE id = ?", (branch["id"],)
        ).fetchone()
    finally:
        conn.close()
    assert saved is not None
    assert saved["status"] == "partial"
    assert saved["content"].startswith("[Mock")
    trace = json.loads(saved["trace_json"])
    assert trace["error_code"] == "client_disconnected"
    assert trace["status"] == "partial"
    assert current_branch["head_commit_id"] == assistant_commit["id"]


def test_branch_settings_and_archive_rules(client, app):
    signup(client)
    space = create_space(client)
    main = main_branch(client, space["id"])

    root_delete = client.delete(
        f"/api/branches/{main['id']}", headers=REQUEST_HEADERS
    )
    assert root_delete.status_code == 409
    assert root_delete.json()["error"]["code"] == "root_branch_protected"

    conn = connect(app)
    try:
        child = fork(conn, main["id"], main["head_commit_id"], "Child")
        grandchild = fork(conn, child["id"], child["head_commit_id"], "Grandchild")
    finally:
        conn.close()

    updated = client.patch(
        f"/api/branches/{child['id']}",
        json={
            "persona": "Direct and concise",
            "thinking_level": "low",
            "top_k": 4,
            "memory_mode": "auto",
        },
        headers=REQUEST_HEADERS,
    )
    assert updated.status_code == 200
    assert updated.json()["persona"] == "Direct and concise"
    assert updated.json()["thinking_level"] == "low"
    assert updated.json()["top_k"] == 4
    assert updated.json()["memory_mode"] == "auto"

    invalid_model = client.patch(
        f"/api/branches/{child['id']}",
        json={"model": "not-allowed"},
        headers=REQUEST_HEADERS,
    )
    assert invalid_model.status_code == 422

    archived = client.delete(
        f"/api/branches/{child['id']}", headers=REQUEST_HEADERS
    )
    assert archived.status_code == 204
    child_after = client.get(f"/api/branches/{child['id']}").json()
    assert child_after["archived"] is True
    blocked_chat = client.post(
        f"/api/branches/{child['id']}/chat",
        json={"message": "Should not stream"},
        headers=REQUEST_HEADERS,
    )
    assert blocked_chat.status_code == 409

    deleted = client.delete(
        f"/api/branches/{grandchild['id']}", headers=REQUEST_HEADERS
    )
    assert deleted.status_code == 204
    assert client.get(f"/api/branches/{grandchild['id']}").status_code == 404
