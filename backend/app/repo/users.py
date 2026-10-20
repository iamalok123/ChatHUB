from __future__ import annotations

import sqlite3

from app.clock import new_id, utc_now


def get_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()


def get_by_id(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create(
    conn: sqlite3.Connection, email: str, password_hash: str, display_name: str
) -> sqlite3.Row:
    user_id = new_id()
    conn.execute(
        """
        INSERT INTO users(id, email, password_hash, display_name, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, email.strip().lower(), password_hash, display_name, utc_now()),
    )
    row = get_by_id(conn, user_id)
    assert row is not None
    return row


def update_display_name(conn: sqlite3.Connection, user_id: str, name: str) -> None:
    conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (name, user_id))


def update_password(conn: sqlite3.Connection, user_id: str, password_hash: str) -> None:
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
