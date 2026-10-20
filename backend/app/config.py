from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

SESSION_COOKIE_NAME = "branchmind_session"
REQUEST_HEADER = "X-BranchMind-Request"

DEFAULT_ALLOWED_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    app_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173
    db_path: Path = field(default_factory=lambda: ROOT_DIR / "data" / "branchmind.db")
    database_url: str = ""

    llm_mode: str = "auto"
    gemini_api_key: str = ""
    gemini_chat_model: str = "gemini-3.8-flash"
    gemini_embed_model: str = "gemini-embedding-001"
    gemini_embed_dim: int = 768
    gemini_allowed_models: tuple[str, ...] = DEFAULT_ALLOWED_MODELS
    gemini_request_timeout_seconds: int = 120

    qdrant_url: str = ""
    qdrant_api_key: str = ""
    qdrant_collection: str = "chathub_memories"

    allow_signup: bool = True
    session_ttl_days: int = 30
    cookie_secure: bool = False
    log_level: str = "INFO"

    history_token_budget: int = 3000
    memory_token_budget: int = 800
    extraction_max_candidates: int = 5
    custom_allowed_origins: tuple[str, ...] = ()

    @classmethod
    def from_env(cls) -> Settings:
        db_raw = os.getenv("DB_PATH", "./data/branchmind.db")
        db_path = Path(db_raw)
        if not db_path.is_absolute():
            db_path = ROOT_DIR / db_path
        allowed = tuple(
            model.strip()
            for model in os.getenv("GEMINI_ALLOWED_MODELS", ",".join(DEFAULT_ALLOWED_MODELS)).split(
                ","
            )
            if model.strip()
        )
        custom_origins = tuple(
            origin.strip()
            for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
        return cls(
            app_host=os.getenv("APP_HOST", "127.0.0.1"),
            backend_port=_env_int("BACKEND_PORT", 8000),
            frontend_port=_env_int("FRONTEND_PORT", 5173),
            db_path=db_path,
            database_url=os.getenv("DATABASE_URL", "").strip(),
            llm_mode=os.getenv("LLM_MODE", "auto").strip().lower(),
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            gemini_chat_model=os.getenv("GEMINI_CHAT_MODEL", "gemini-3.8-flash").strip(),
            gemini_embed_model=os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001").strip(),
            gemini_embed_dim=_env_int("GEMINI_EMBED_DIM", 768),
            gemini_allowed_models=allowed,
            gemini_request_timeout_seconds=_env_int("GEMINI_REQUEST_TIMEOUT_SECONDS", 120),
            qdrant_url=os.getenv("QDRANT_URL", "").strip(),
            qdrant_api_key=os.getenv("QDRANT_API_KEY", "").strip(),
            qdrant_collection=os.getenv("QDRANT_COLLECTION", "chathub_memories").strip(),
            allow_signup=_env_bool("ALLOW_SIGNUP", True),
            session_ttl_days=_env_int("SESSION_TTL_DAYS", 30),
            cookie_secure=_env_bool("COOKIE_SECURE", False),
            log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
            history_token_budget=_env_int("HISTORY_TOKEN_BUDGET", 3000),
            memory_token_budget=_env_int("MEMORY_TOKEN_BUDGET", 800),
            extraction_max_candidates=_env_int("EXTRACTION_MAX_CANDIDATES", 5),
            custom_allowed_origins=custom_origins,
        )

    @property
    def is_postgres(self) -> bool:
        return bool(
            self.database_url.startswith("postgresql://")
            or self.database_url.startswith("postgres://")
        )

    @property
    def effective_llm_mode(self) -> str:
        if self.llm_mode == "auto":
            return "gemini" if self.gemini_api_key else "mock"
        return self.llm_mode

    @property
    def allowed_origins(self) -> tuple[str, ...]:
        ports = {self.frontend_port, self.backend_port}
        origins: list[str] = list(self.custom_allowed_origins)
        for port in sorted(ports):
            origins.extend([f"http://127.0.0.1:{port}", f"http://localhost:{port}"])
        return tuple(dict.fromkeys(origins))

    def validate_runtime(self) -> None:
        if self.app_host not in {"127.0.0.1", "localhost", "0.0.0.0"}:
            raise ValueError("ChartHub only binds to loopback hosts or 0.0.0.0 in production")
        if self.llm_mode not in {"auto", "gemini", "mock"}:
            raise ValueError("LLM_MODE must be auto, gemini, or mock")
        if self.llm_mode == "gemini" and not self.gemini_api_key:
            raise ValueError("LLM_MODE=gemini requires GEMINI_API_KEY")
        if self.gemini_chat_model not in self.gemini_allowed_models:
            raise ValueError("GEMINI_CHAT_MODEL is not in GEMINI_ALLOWED_MODELS")
        if self.gemini_embed_dim <= 0:
            raise ValueError("GEMINI_EMBED_DIM must be positive")
        if self.session_ttl_days <= 0:
            raise ValueError("SESSION_TTL_DAYS must be positive")
