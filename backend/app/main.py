from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.auth.ratelimit import SlidingWindowLimiter
from app.auth.sessions import purge_expired
from app.config import REQUEST_HEADER, Settings
from app.db import Database
from app.engine.outbox import OutboxProcessor
from app.errors import install_error_handlers
from app.llm import build_provider
from app.llm.qdrant import QdrantStore
from app.routes import auth, branches, chat, health, memories, ops, spaces

logger = logging.getLogger("chathub")

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate_runtime()

    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    database = Database(settings.db_path, database_url=settings.database_url)
    provider = build_provider(settings)
    qdrant = QdrantStore(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        collection=settings.qdrant_collection,
        dim=settings.gemini_embed_dim,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        conn = database.connect()
        try:
            purge_expired(conn)
        finally:
            conn.close()
        logger.info(
            "ChatHUB ready in %s mode on %s:%s (db: %s, qdrant: %s)",
            settings.effective_llm_mode,
            settings.app_host,
            settings.backend_port,
            "postgresql" if settings.is_postgres else "sqlite",
            "connected" if qdrant.is_enabled else "in-memory/local",
        )
        outbox_task = asyncio.create_task(OutboxProcessor.run_worker(database, qdrant))
        try:
            yield
        finally:
            outbox_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await outbox_task
            await provider.close()

    app = FastAPI(
        title="ChatHUB",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.settings = settings
    app.state.database = database
    app.state.provider = provider
    app.state.qdrant = qdrant
    app.state.signup_limiter = SlidingWindowLimiter(limit=5, window_seconds=600)
    app.state.login_limiter = SlidingWindowLimiter(limit=10, window_seconds=300)

    install_error_handlers(app)

    @app.middleware("http")
    async def local_request_guard(request: Request, call_next: Any) -> Any:
        if request.url.path.startswith("/api") and request.method in MUTATING_METHODS:
            if request.headers.get(REQUEST_HEADER) != "1":
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "missing_request_header",
                            "message": "Missing local request header",
                        }
                    },
                )
            origin = request.headers.get("origin")
            if origin and origin not in settings.allowed_origins:
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "origin_not_allowed",
                            "message": "Request origin is not allowed",
                        }
                    },
                )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(spaces.router, prefix="/api")
    app.include_router(branches.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(memories.router, prefix="/api")
    app.include_router(ops.router, prefix="/api")

    return app


app = create_app()
