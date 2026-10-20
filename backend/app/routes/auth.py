from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.auth import service, sessions
from app.auth.deps import (
    CurrentUser,
    DbConn,
    clear_session_cookie,
    set_session_cookie,
)
from app.config import SESSION_COOKIE_NAME
from app.errors import ApiError
from app.models import (
    AuthConfigOut,
    AuthResponse,
    ChangePasswordRequest,
    LoginRequest,
    SignupRequest,
    UpdateMeRequest,
    UserOut,
    user_out,
)
from app.repo import users

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "local"


@router.get("/config", response_model=AuthConfigOut)
def auth_config(request: Request) -> AuthConfigOut:
    settings = request.app.state.settings
    return AuthConfigOut(
        signup_enabled=settings.allow_signup,
        llm_mode=settings.effective_llm_mode,
    )


@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(
    payload: SignupRequest,
    request: Request,
    response: Response,
    conn: DbConn,
) -> AuthResponse:
    settings = request.app.state.settings
    if not settings.allow_signup:
        raise ApiError(403, "signup_disabled", "Signups are disabled")
    request.app.state.signup_limiter.check(_client_key(request))
    user, token = service.signup(
        conn,
        str(payload.email),
        payload.display_name,
        payload.password,
        settings.session_ttl_days,
    )
    set_session_cookie(
        response, token, settings.session_ttl_days * 86400, settings.cookie_secure
    )
    return AuthResponse(user=user_out(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    conn: DbConn,
) -> AuthResponse:
    settings = request.app.state.settings
    request.app.state.login_limiter.check(_client_key(request))
    user, token = service.login(
        conn, str(payload.email), payload.password, settings.session_ttl_days
    )
    set_session_cookie(
        response, token, settings.session_ttl_days * 86400, settings.cookie_secure
    )
    return AuthResponse(user=user_out(user))


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    conn: DbConn,
) -> Response:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        sessions.delete_session(conn, token)
    clear_session_cookie(response, request.app.state.settings.cookie_secure)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UpdateMeRequest,
    user: CurrentUser,
    conn: DbConn,
) -> UserOut:
    users.update_display_name(conn, user.id, payload.display_name)
    conn.commit()
    row = users.get_by_id(conn, user.id)
    assert row is not None
    return user_out(row)


@router.post("/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: CurrentUser,
    conn: DbConn,
) -> Response:
    service.change_password(
        conn,
        user.id,
        payload.current_password,
        payload.new_password,
        request.state.session_token,
    )
    return Response(status_code=204)
