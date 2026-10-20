from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from app.auth import sessions
from tests.helpers import REQUEST_HEADERS, signup


def test_signup_sets_secure_cookie_attributes(client):
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "ada@example.com",
            "display_name": "Ada",
            "password": "correct horse battery",
        },
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["user"]["email"] == "ada@example.com"
    assert "password" not in payload
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Ada"


def test_email_is_normalized_and_duplicate_is_rejected(client):
    signup(client, email="Ada@Example.COM")
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "ada@example.com",
            "display_name": "Duplicate",
            "password": "correct horse battery",
        },
        headers=REQUEST_HEADERS,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


def test_mutations_require_local_header_and_allowed_origin(client):
    missing = client.post(
        "/api/auth/signup",
        json={
            "email": "a@example.com",
            "display_name": "A",
            "password": "correct horse battery",
        },
    )
    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "missing_request_header"

    bad_origin = client.post(
        "/api/auth/signup",
        json={
            "email": "a@example.com",
            "display_name": "A",
            "password": "correct horse battery",
        },
        headers={**REQUEST_HEADERS, "Origin": "http://evil.example"},
    )
    assert bad_origin.status_code == 403
    assert bad_origin.json()["error"]["code"] == "origin_not_allowed"

    good_origin = client.post(
        "/api/auth/signup",
        json={
            "email": "a@example.com",
            "display_name": "A",
            "password": "correct horse battery",
        },
        headers={**REQUEST_HEADERS, "Origin": "http://127.0.0.1:5173"},
    )
    assert good_origin.status_code == 201


def test_unauthenticated_requests_are_401(client):
    for path in ("/api/spaces", "/api/auth/me"):
        response = client.get(path)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"


def test_login_logout(client):
    signup(client, email="login@example.com", password="correct horse battery")
    response = client.post("/api/auth/logout", headers=REQUEST_HEADERS)
    assert response.status_code == 204
    assert client.get("/api/auth/me").status_code == 401

    wrong = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "wrong password"},
        headers=REQUEST_HEADERS,
    )
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "invalid_credentials"

    right = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "correct horse battery"},
        headers=REQUEST_HEADERS,
    )
    assert right.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_password_change_revokes_other_sessions_and_rotates_secret(client, app):
    signup(client, email="rotate@example.com", password="correct horse battery")

    with TestClient(app) as other:
        login = other.post(
            "/api/auth/login",
            json={"email": "rotate@example.com", "password": "correct horse battery"},
            headers=REQUEST_HEADERS,
        )
        assert login.status_code == 200
        assert other.get("/api/auth/me").status_code == 200

        changed = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "correct horse battery",
                "new_password": "a brand new passphrase",
            },
            headers=REQUEST_HEADERS,
        )
        assert changed.status_code == 204
        assert other.get("/api/auth/me").status_code == 401
        assert client.get("/api/auth/me").status_code == 200

    client.post("/api/auth/logout", headers=REQUEST_HEADERS)
    old = client.post(
        "/api/auth/login",
        json={"email": "rotate@example.com", "password": "correct horse battery"},
        headers=REQUEST_HEADERS,
    )
    assert old.status_code == 401
    new = client.post(
        "/api/auth/login",
        json={"email": "rotate@example.com", "password": "a brand new passphrase"},
        headers=REQUEST_HEADERS,
    )
    assert new.status_code == 200


def test_passwords_and_session_tokens_are_hashed(client, app):
    signup(client, email="hash@example.com", password="correct horse battery")
    conn: sqlite3.Connection = app.state.database.connect()
    try:
        user = conn.execute("SELECT * FROM users WHERE email = 'hash@example.com'").fetchone()
        session = conn.execute("SELECT * FROM sessions").fetchone()
    finally:
        conn.close()
    assert user is not None
    assert user["password_hash"] != "correct horse battery"
    assert user["password_hash"].startswith("$argon2id$")
    assert session is not None
    cookie_token = client.cookies.get("branchmind_session")
    assert cookie_token
    assert session["token_hash"] != cookie_token
    assert session["token_hash"] == sessions.hash_token(cookie_token)


def test_expired_session_is_rejected(client, app):
    signup(client)
    conn: sqlite3.Connection = app.state.database.connect()
    try:
        conn.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
        conn.commit()
    finally:
        conn.close()
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_update_display_name(client):
    signup(client, display_name="Ada")
    response = client.patch(
        "/api/auth/me", json={"display_name": "Ada Lovelace"}, headers=REQUEST_HEADERS
    )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Ada Lovelace"
