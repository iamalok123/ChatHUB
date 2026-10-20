from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        db_path=tmp_path / "branchmind-test.db",
        llm_mode="mock",
        gemini_api_key="",
        allow_signup=True,
        cookie_secure=False,
    )


@pytest.fixture
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db(settings: Settings):
    database = Database(settings.db_path)
    database.initialize()
    conn = database.connect()
    try:
        yield conn
    finally:
        conn.close()
