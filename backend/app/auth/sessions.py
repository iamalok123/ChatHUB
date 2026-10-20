from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from app.clock import new_id, utc_now

TOKEN_BYTES = 32


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _future(days: int) -> str:
    moment = datetime.now(UTC) + timedelta(days=days)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def create_session(conn: sqlite3.Connection, user_id: str, ttl_days: int) -> str:
    token = secrets.token_urlsafe(TOKEN_BYTES)
    now = utc_now()
    conn.execute(
        """
        INSERT INTO sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id(), user_id, hash_token(token), now, _future(ttl_days), now),
    )
    conn.commit()
    return token


def get_user_for_token(conn: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    now = utc_now()
    row = conn.execute(
        """
        SELECT users.*, sessions.id AS session_id, sessions.expires_at
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """,
        (hash_token(token), now),
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "UPDATE sessions SET last_seen_at = ? WHERE id = ?", (now, row["session_id"])
    )
    conn.commit()
    return row


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
    conn.commit()


def delete_other_sessions(
    conn: sqlite3.Connection, user_id: str, keep_token: str
) -> None:
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
        (user_id, hash_token(keep_token)),
    )
    conn.commit()


def delete_all_for_user(conn: sqlite3.Connection, user_id: str) -> None:
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()


def purge_expired(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (utc_now(),))
    conn.commit()
