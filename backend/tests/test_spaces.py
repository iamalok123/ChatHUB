from __future__ import annotations

import sqlite3

from tests.helpers import REQUEST_HEADERS, create_space, signup


def test_space_creation_builds_main_and_anchor(client, app):
    signup(client)
    space = create_space(client, "Personal memory")

    response = client.get(f"/api/spaces/{space['id']}/branches")
    assert response.status_code == 200
    branches = response.json()
    assert len(branches) == 1
    branch = branches[0]
    assert branch["name"] == "main"
    assert branch["is_root"] is True
    assert branch["parent_branch_id"] is None
    assert branch["message_count"] == 0
    assert branch["memory_count"] == 0

    conn: sqlite3.Connection = app.state.database.connect()
    try:
        anchor = conn.execute(
            "SELECT * FROM commits WHERE branch_id = ?", (branch["id"],)
        ).fetchone()
    finally:
        conn.close()
    assert anchor is not None
    assert anchor["role"] == "anchor"
    assert anchor["parent_id"] is None
    assert branch["head_commit_id"] == anchor["id"]


def test_space_profile_round_trip(client):
    signup(client)
    created = client.post(
        "/api/spaces",
        json={
            "name": "Work",
            "description": "Plans and decisions",
            "profile": {"tone": "direct", "timezone": "Asia/Kolkata"},
        },
        headers=REQUEST_HEADERS,
    )
    assert created.status_code == 201
    body = created.json()
    assert body["profile"]["tone"] == "direct"

    updated = client.patch(
        f"/api/spaces/{body['id']}",
        json={"name": "Deep work", "profile": {"tone": "warm"}},
        headers=REQUEST_HEADERS,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Deep work"
    assert updated.json()["profile"] == {"tone": "warm"}


def test_cross_user_space_access_is_404(client):
    signup(client, email="owner@example.com")
    space = create_space(client)
    client.post("/api/auth/logout", headers=REQUEST_HEADERS)

    signup(client, email="intruder@example.com")

    assert client.get(f"/api/spaces/{space['id']}").status_code == 404
    assert client.get(f"/api/spaces/{space['id']}/branches").status_code == 404
    assert (
        client.patch(
            f"/api/spaces/{space['id']}",
            json={"name": "Stolen"},
            headers=REQUEST_HEADERS,
        ).status_code
        == 404
    )
    assert client.delete(f"/api/spaces/{space['id']}", headers=REQUEST_HEADERS).status_code == 404
    assert client.get("/api/spaces").json() == []


def test_space_delete_cascades(client, app):
    signup(client)
    space = create_space(client)
    branch = client.get(f"/api/spaces/{space['id']}/branches").json()[0]

    response = client.delete(f"/api/spaces/{space['id']}", headers=REQUEST_HEADERS)
    assert response.status_code == 204

    conn: sqlite3.Connection = app.state.database.connect()
    try:
        assert (
            conn.execute("SELECT COUNT(*) FROM branches WHERE id = ?", (branch["id"],)).fetchone()[
                0
            ]
            == 0
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM commits WHERE branch_id = ?", (branch["id"],)
            ).fetchone()[0]
            == 0
        )
    finally:
        conn.close()


def test_invalid_space_name_is_422(client):
    signup(client)
    response = client.post("/api/spaces", json={"name": "   "}, headers=REQUEST_HEADERS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
