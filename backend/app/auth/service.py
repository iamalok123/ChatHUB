from __future__ import annotations

import sqlite3

from app.auth import sessions
from app.auth.passwords import (
    hash_password,
    password_needs_rehash,
    verify_password,
)
from app.errors import ApiError
from app.repo import users


def normalize_email(email: str) -> str:
    return email.strip().lower()


def signup(
    conn: sqlite3.Connection, email: str, display_name: str, password: str, ttl_days: int
) -> tuple[sqlite3.Row, str]:
    normalized = normalize_email(email)
    if users.get_by_email(conn, normalized) is not None:
        raise ApiError(409, "email_taken", "An account with that email already exists")
    try:
        user = users.create(conn, normalized, hash_password(password), display_name)
        conn.commit()
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise ApiError(409, "email_taken", "An account with that email already exists") from exc
    token = sessions.create_session(conn, user["id"], ttl_days)
    return user, token


def login(
    conn: sqlite3.Connection, email: str, password: str, ttl_days: int
) -> tuple[sqlite3.Row, str]:
    user = users.get_by_email(conn, normalize_email(email))
    if user is None or not verify_password(password, user["password_hash"]):
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect")
    if password_needs_rehash(user["password_hash"]):
        users.update_password(conn, user["id"], hash_password(password))
        conn.commit()
    token = sessions.create_session(conn, user["id"], ttl_days)
    return user, token


def change_password(
    conn: sqlite3.Connection,
    user_id: str,
    current_password: str,
    new_password: str,
    current_token: str,
) -> None:
    user = users.get_by_id(conn, user_id)
    if user is None or not verify_password(current_password, user["password_hash"]):
        raise ApiError(401, "invalid_credentials", "Current password is incorrect")
    users.update_password(conn, user_id, hash_password(new_password))
    conn.commit()
    sessions.delete_other_sessions(conn, user_id, current_token)
