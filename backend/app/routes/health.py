from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    db_ok = True
    try:
        conn = request.app.state.database.connect()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()
    except Exception:
        db_ok = False

    body = {
        "status": "ok" if db_ok else "degraded",
        "version": __version__,
        "llm_mode": settings.effective_llm_mode,
        "gemini": {
            "configured": bool(settings.gemini_api_key),
            "chat_model": settings.gemini_chat_model,
            "embed_model": settings.gemini_embed_model,
        },
        "auth": {
            "signup_enabled": settings.allow_signup,
            "session_ttl_days": settings.session_ttl_days,
        },
        "privacy": {
            "key_location": "server",
            "host": settings.app_host,
        },
    }
    return JSONResponse(status_code=200 if db_ok else 503, content=body)
