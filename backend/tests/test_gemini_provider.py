from __future__ import annotations

import base64
import os

import pytest
from google.genai import errors, types

from app.config import Settings
from app.llm.base import ChatTurn, ProviderError
from app.llm.gemini import GeminiProvider, map_provider_exception


def gemini_settings(tmp_path) -> Settings:
    return Settings(
        db_path=tmp_path / "gemini.db",
        llm_mode="gemini",
        gemini_api_key="test-key-not-real",
        gemini_allowed_models=("gemini-3.8-flash",),
    )


def chunk(text: str) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(
                    role="model", parts=[types.Part(text=text)]
                )
            )
        ]
    )


def test_auto_mode_falls_back_to_mock_and_gemini_requires_key(tmp_path):
    auto = Settings(db_path=tmp_path / "auto.db", llm_mode="auto", gemini_api_key="")
    assert auto.effective_llm_mode == "mock"
    auto.validate_runtime()

    explicit = Settings(
        db_path=tmp_path / "explicit.db", llm_mode="gemini", gemini_api_key=""
    )
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        explicit.validate_runtime()


def test_replay_keeps_text_signature_and_drops_thoughts(tmp_path):
    provider = GeminiProvider(gemini_settings(tmp_path))
    signature = base64.b64encode(b"signature").decode("ascii")
    contents = provider._contents(
        [
            ChatTurn(
                role="assistant",
                text="Hello",
                parts=[
                    {"text": "hidden thought", "thought": True, "thought_signature": None},
                    {"text": "Hello", "thought": False, "thought_signature": signature},
                ],
            )
        ]
    )
    parts = contents[0].parts
    assert len(parts) == 1
    assert parts[0].text == "Hello"
    assert parts[0].thought_signature == b"signature"


def test_error_mapping_is_safe_and_actionable():
    rate = map_provider_exception(
        errors.APIError(429, {"error": {"message": "quota exceeded"}})
    )
    assert rate.code == "rate_limited"
    assert rate.retryable is True

    auth = map_provider_exception(
        errors.APIError(403, {"error": {"message": "permission denied"}})
    )
    assert auth.code == "authentication_failed"
    assert auth.retryable is False

    unavailable = map_provider_exception(
        errors.APIError(503, {"error": {"message": "try later"}})
    )
    assert unavailable.code == "provider_unavailable"
    assert unavailable.retryable is True

    missing = map_provider_exception(
        errors.APIError(404, {"error": {"message": "model missing"}})
    )
    assert missing.code == "model_not_found"

    generic = map_provider_exception(RuntimeError("secret internals"))
    assert generic.code == "provider_error"
    assert "secret" not in generic.message


@pytest.mark.asyncio
async def test_stream_retries_before_first_token(tmp_path):
    provider = GeminiProvider(gemini_settings(tmp_path))
    calls = 0

    def fake_open(model, contents, config):
        nonlocal calls
        calls += 1
        if calls < 3:
            raise errors.APIError(503, {"error": {"message": "busy"}})

        async def stream():
            yield chunk("Hello ")
            yield chunk("world")

        return stream()

    async def no_sleep(_seconds):
        return None

    provider._open_stream = fake_open  # type: ignore[method-assign]
    provider._sleep = no_sleep  # type: ignore[method-assign]

    events = [
        event
        async for event in provider.stream_chat(
            system_instruction="",
            turns=[ChatTurn(role="user", text="Hi")],
        )
    ]
    assert calls == 3
    assert events[-1].completion is not None
    assert events[-1].completion.text == "Hello world"


@pytest.mark.asyncio
async def test_stream_does_not_retry_after_tokens(tmp_path):
    provider = GeminiProvider(gemini_settings(tmp_path))

    def fake_open(model, contents, config):
        async def stream():
            yield chunk("Partial")
            raise errors.APIError(429, {"error": {"message": "quota"}})

        return stream()

    provider._open_stream = fake_open  # type: ignore[method-assign]

    with pytest.raises(ProviderError) as caught:
        async for _event in provider.stream_chat(
            system_instruction="",
            turns=[ChatTurn(role="user", text="Hi")],
        ):
            pass
    assert caught.value.code == "rate_limited"
    assert caught.value.started is True
    assert caught.value.partial_text == "Partial"


@pytest.mark.asyncio
async def test_model_allowlist_is_enforced(tmp_path):
    provider = GeminiProvider(gemini_settings(tmp_path))
    with pytest.raises(ProviderError) as caught:
        async for _event in provider.stream_chat(
            system_instruction="",
            turns=[ChatTurn(role="user", text="Hi")],
            model="gemini-unapproved",
        ):
            pass
    assert caught.value.code == "model_not_allowed"


@pytest.mark.live
@pytest.mark.skipif(
    not os.getenv("GEMINI_API_KEY") or os.getenv("RUN_LIVE_TESTS") != "1",
    reason="Live Gemini tests require GEMINI_API_KEY and RUN_LIVE_TESTS=1",
)
@pytest.mark.asyncio
async def test_live_gemini_embedding():
    provider = GeminiProvider(Settings.from_env())
    vectors = await provider.embed(["live smoke test"])
    assert len(vectors) == 1
    assert len(vectors[0]) == provider.embed_dim
    await provider.close()
