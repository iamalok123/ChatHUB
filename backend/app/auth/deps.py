from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.responses import Response

from app.auth import sessions
from app.config import SESSION_COOKIE_NAME
from app.errors import unauthorized
from app.models import UserOut, user_out


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    conn = request.app.state.database.connect()
    try:
        yield conn
    finally:
        conn.close()


def require_user(request: Request) -> UserOut:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise unauthorized()
    conn = request.app.state.database.connect()
    try:
        row = sessions.get_user_for_token(conn, token)
    finally:
        conn.close()
    if row is None:
        raise unauthorized()
    request.state.session_token = token
    request.state.user_id = row["id"]
    return user_out(row)


DbConn = Annotated[sqlite3.Connection, Depends(get_db)]
CurrentUser = Annotated[UserOut, Depends(require_user)]


def set_session_cookie(response: Response, token: str, max_age: int, secure: bool) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_session_cookie(response: Response, secure: bool) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
