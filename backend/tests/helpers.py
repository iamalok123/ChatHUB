from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi.testclient import TestClient

from app.models import UserOut
from app.repo import branches, commits

REQUEST_HEADERS = {"X-BranchMind-Request": "1"}


def signup(
    client: TestClient,
    email: str = "ada@example.com",
    password: str = "correct horse battery",
    display_name: str = "Ada",
) -> UserOut:
    response = client.post(
        "/api/auth/signup",
        json={"email": email, "display_name": display_name, "password": password},
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 201, response.text
    return UserOut(**response.json()["user"])


def create_space(client: TestClient, name: str = "Research") -> dict:
    response = client.post("/api/spaces", json={"name": name}, headers=REQUEST_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def append(conn: sqlite3.Connection, branch_id: str, role: str, content: str):
    branch = conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()
    assert branch is not None
    return commits.create(
        conn,
        space_id=branch["space_id"],
        branch_id=branch_id,
        role=role,
        content=content,
        parent_id=branch["head_commit_id"],
    )


def refresh_branch(conn: sqlite3.Connection, branch_id: str):
    return conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()


def parse_sse(lines: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event_name: str | None = None
    data: list[str] = []
    for raw in lines:
        line = raw if isinstance(raw, str) else raw.decode("utf-8")
        if not line:
            if event_name is not None:
                payload = "\n".join(data)
                events.append(
                    {
                        "event": event_name,
                        "data": json.loads(payload) if payload else {},
                    }
                )
            event_name = None
            data = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data.append(line.split(":", 1)[1].lstrip())
    if event_name is not None:
        payload = "\n".join(data)
        events.append({"event": event_name, "data": json.loads(payload) if payload else {}})
    return events


def stream_chat(
    client: TestClient,
    branch_id: str,
    message: str,
    expected_head_id: str | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    payload: dict[str, Any] = {"message": message}
    if expected_head_id is not None:
        payload["expected_head_id"] = expected_head_id
    with client.stream(
        "POST",
        f"/api/branches/{branch_id}/chat",
        json=payload,
        headers=REQUEST_HEADERS,
    ) as response:
        status = response.status_code
        events = parse_sse(response.iter_lines())
    return status, events


def stream_regenerate(
    client: TestClient, branch_id: str, commit_id: str
) -> tuple[int, list[dict[str, Any]]]:
    with client.stream(
        "POST",
        f"/api/branches/{branch_id}/regenerate/{commit_id}",
        headers=REQUEST_HEADERS,
    ) as response:
        status = response.status_code
        events = parse_sse(response.iter_lines())
    return status, events


def fork(conn: sqlite3.Connection, parent_branch_id: str, fork_commit_id: str, name: str):
    parent = conn.execute("SELECT * FROM branches WHERE id = ?", (parent_branch_id,)).fetchone()
    assert parent is not None
    branch, _anchor = branches.create(
        conn,
        space_id=parent["space_id"],
        name=name,
        parent_branch_id=parent_branch_id,
        fork_commit_id=fork_commit_id,
    )
    return branch
