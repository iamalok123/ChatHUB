from __future__ import annotations

import sqlite3

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
    response = client.post(
        "/api/spaces", json={"name": name}, headers=REQUEST_HEADERS
    )
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


def fork(conn: sqlite3.Connection, parent_branch_id: str, fork_commit_id: str, name: str):
    parent = conn.execute(
        "SELECT * FROM branches WHERE id = ?", (parent_branch_id,)
    ).fetchone()
    assert parent is not None
    branch, _anchor = branches.create(
        conn,
        space_id=parent["space_id"],
        name=name,
        parent_branch_id=parent_branch_id,
        fork_commit_id=fork_commit_id,
    )
    return branch
