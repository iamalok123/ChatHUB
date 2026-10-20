from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from app.clock import utc_now
from app.config import Settings
from app.llm.base import (
    ChatTurn,
    Completion,
    LLMProvider,
    MemoryCandidate,
    ProviderError,
    StreamEvent,
    TaskType,
)
from app.llm.embeddings import validate_vectors
from app.llm.health import ProviderHealth
from app.llm.jsonparse import parse_json_payload

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.0)
EMBED_BATCH_SIZE = 100
HEALTH_TTL_SECONDS = 60.0
USAGE_FIELDS = (
    "prompt_token_count",
    "candidates_token_count",
    "thoughts_token_count",
    "cached_content_token_count",
    "tool_use_prompt_token_count",
    "total_token_count",
)

EXTRACTION_INSTRUCTION = """You extract durable memories from one conversation turn.
Return only a JSON array. Each item must have:
- "content": a short standalone statement in the user's voice
- "kind": one of fact, preference, decision, profile, summary, task
- "importance": a number from 0 to 1

Remember durable facts, preferences, decisions, and tasks. Never invent details.
Do not store secrets, passwords, API keys, or one-off small talk.
Return [] when nothing is worth remembering."""


def _api_error_code(exc: errors.APIError) -> int:
    try:
        return int(exc.code)
    except (TypeError, ValueError):
        return 0


def map_provider_exception(exc: Exception) -> ProviderError:
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, errors.APIError):
        code = _api_error_code(exc)
        message = (exc.message or "").lower()
        if code == 429:
            return ProviderError(
                "rate_limited",
                "Gemini rate limit reached. Try again shortly.",
                retryable=True,
                status_code=429,
            )
        if code >= 500:
            return ProviderError(
                "provider_unavailable",
                "Gemini is temporarily unavailable.",
                retryable=True,
                status_code=code,
            )
        if code in {401, 403} or "api key" in message:
            return ProviderError(
                "authentication_failed",
                "Gemini authentication failed. Check GEMINI_API_KEY.",
                status_code=code or 401,
            )
        if code == 404:
            return ProviderError(
                "model_not_found",
                "The configured Gemini model is not available.",
                status_code=404,
            )
        if code == 400:
            return ProviderError(
                "invalid_request",
                "Gemini rejected the request.",
                status_code=400,
            )
        return ProviderError(
            "provider_error", "Gemini request failed.", status_code=code or None
        )
    if isinstance(exc, (httpx.TimeoutException, TimeoutError, asyncio.TimeoutError)):
        return ProviderError(
            "provider_timeout", "Gemini timed out.", retryable=True
        )
    if isinstance(exc, (httpx.HTTPError, ConnectionError, OSError)):
        return ProviderError(
            "provider_unreachable", "Could not reach Gemini.", retryable=True
        )
    return ProviderError("provider_error", "Gemini request failed.")


def _signature_to_b64(signature: Any) -> str | None:
    if not signature:
        return None
    if isinstance(signature, bytes):
        return base64.b64encode(signature).decode("ascii")
    if isinstance(signature, str):
        return signature
    return None


def _signature_from_b64(value: Any) -> bytes | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (ValueError, UnicodeEncodeError):
        return None


def _finish_reason(response: types.GenerateContentResponse) -> str | None:
    if not response.candidates:
        if response.prompt_feedback and response.prompt_feedback.block_reason:
            return "BLOCKED"
        return None
    reason = response.candidates[0].finish_reason
    if reason is None:
        return None
    return getattr(reason, "name", str(reason))


@dataclass
class _Accumulator:
    text: list[str] = field(default_factory=list)
    thinking: list[str] = field(default_factory=list)
    parts: list[dict[str, Any]] = field(default_factory=list)
    signature: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str | None = None

    @property
    def answer(self) -> str:
        return "".join(self.text)


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, settings: Settings) -> None:
        self.chat_model = settings.gemini_chat_model
        self.embed_model = settings.gemini_embed_model
        self.embed_dim = settings.gemini_embed_dim
        self._allowed_models = set(settings.gemini_allowed_models)
        self._configured = bool(settings.gemini_api_key)
        self._client = genai.Client(
            api_key=settings.gemini_api_key or None,
            http_options=types.HttpOptions(
                timeout=settings.gemini_request_timeout_seconds * 1000
            ),
        )
        self._health_cache: ProviderHealth | None = None
        self._health_at = 0.0

    def _model_name(self, override: str | None) -> str:
        model = override or self.chat_model
        if model not in self._allowed_models:
            raise ProviderError(
                "model_not_allowed",
                "This Gemini model is not allowed by configuration.",
                status_code=400,
            )
        return model

    @staticmethod
    def _thinking_level(level: str) -> str:
        normalized = level.lower()
        if normalized not in {"low", "medium", "high"}:
            return "medium"
        return normalized

    def _contents(self, turns: Sequence[ChatTurn]) -> list[types.Content]:
        if not turns:
            return [types.Content(role="user", parts=[types.Part(text=" ")])]
        contents: list[types.Content] = []
        for turn in turns:
            if turn.role == "assistant" and turn.parts:
                parts: list[types.Part] = []
                for raw in turn.parts:
                    if raw.get("thought"):
                        continue
                    text = raw.get("text") or ""
                    signature = _signature_from_b64(raw.get("thought_signature"))
                    if not text and signature is None:
                        continue
                    parts.append(
                        types.Part(text=text or None, thought_signature=signature)
                    )
                if not parts:
                    parts = [types.Part(text=turn.text)]
                contents.append(types.Content(role="model", parts=parts))
            else:
                role = "model" if turn.role == "assistant" else "user"
                contents.append(
                    types.Content(role=role, parts=[types.Part(text=turn.text)])
                )
        return contents

    def _open_stream(
        self,
        model: str,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
    ) -> AsyncIterator[types.GenerateContentResponse]:
        return self._client.aio.models.generate_content_stream(
            model=model, contents=contents, config=config
        )

    async def _sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def stream_chat(
        self,
        *,
        system_instruction: str,
        turns: Sequence[ChatTurn],
        thinking_level: str = "medium",
        model: str | None = None,
        max_output_tokens: int | None = None,
    ) -> AsyncIterator[StreamEvent]:
        model_name = self._model_name(model)
        contents = self._contents(turns)
        config = types.GenerateContentConfig(
            system_instruction=system_instruction or None,
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_level=self._thinking_level(thinking_level),
            ),
            max_output_tokens=max_output_tokens,
        )

        stream: AsyncIterator[types.GenerateContentResponse] | None = None
        first: types.GenerateContentResponse | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                stream = self._open_stream(model_name, contents, config)
                try:
                    first = await anext(stream)
                except StopAsyncIteration:
                    first = None
                break
            except Exception as exc:
                mapped = map_provider_exception(exc)
                if mapped.retryable and attempt < MAX_ATTEMPTS - 1:
                    await self._sleep(BACKOFF_SECONDS[attempt])
                    continue
                raise mapped from exc

        acc = _Accumulator()
        if first is not None:
            for event in self._events_from_response(first, acc):
                yield event
            assert stream is not None
            try:
                async for response in stream:
                    for event in self._events_from_response(response, acc):
                        yield event
            except Exception as exc:
                mapped = map_provider_exception(exc)
                mapped.partial_text = acc.answer
                mapped.partial_thinking = "".join(acc.thinking)
                mapped.started = True
                raise mapped from exc

        completion = Completion(
            text=acc.answer,
            thinking="".join(acc.thinking),
            parts=acc.parts,
            thought_signature=acc.signature,
            usage=acc.usage,
            model=model_name,
            provider=self.name,
            finish_reason=acc.finish_reason,
        )
        yield StreamEvent(kind="done", completion=completion)

    def _events_from_response(
        self, response: types.GenerateContentResponse, acc: _Accumulator
    ) -> list[StreamEvent]:
        events: list[StreamEvent] = []
        if response.usage_metadata:
            for field_name in USAGE_FIELDS:
                value = getattr(response.usage_metadata, field_name, None)
                if value is not None:
                    acc.usage[field_name] = int(value)
        reason = _finish_reason(response)
        if reason:
            acc.finish_reason = reason

        if not response.candidates:
            return events
        content = response.candidates[0].content
        if content is None or not content.parts:
            return events

        for part in content.parts:
            signature = _signature_to_b64(part.thought_signature)
            if signature:
                acc.signature = signature
            text = part.text or ""
            if not text:
                continue
            acc.parts.append(
                {
                    "text": text,
                    "thought": bool(part.thought),
                    "thought_signature": signature,
                }
            )
            if part.thought:
                acc.thinking.append(text)
                events.append(StreamEvent(kind="thought", text=text))
            else:
                acc.text.append(text)
                events.append(StreamEvent(kind="token", text=text))
        return events

    async def _generate_once(
        self,
        *,
        model: str,
        contents: str | list[types.Content],
        config: types.GenerateContentConfig,
    ) -> types.GenerateContentResponse:
        for attempt in range(MAX_ATTEMPTS):
            try:
                return await self._client.aio.models.generate_content(
                    model=model, contents=contents, config=config
                )
            except Exception as exc:
                mapped = map_provider_exception(exc)
                if mapped.retryable and attempt < MAX_ATTEMPTS - 1:
                    await self._sleep(BACKOFF_SECONDS[attempt])
                    continue
                raise mapped from exc
        raise ProviderError("provider_error", "Gemini request failed.")

    async def generate_json(
        self,
        *,
        prompt: str,
        system_instruction: str = "",
        model: str | None = None,
        max_output_tokens: int = 1024,
    ) -> str:
        response = await self._generate_once(
            model=self._model_name(model),
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction or None,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(
                    include_thoughts=False, thinking_level="low"
                ),
                max_output_tokens=max_output_tokens,
            ),
        )
        return response.text or ""

    async def extract_memories(
        self,
        *,
        user_text: str,
        assistant_text: str,
        max_candidates: int = 5,
    ) -> list[MemoryCandidate]:
        payload = json.dumps(
            {"user": user_text, "assistant": assistant_text}, ensure_ascii=False
        )
        raw = await self.generate_json(
            prompt=payload,
            system_instruction=EXTRACTION_INSTRUCTION,
            max_output_tokens=1024,
        )
        parsed = parse_json_payload(raw)
        if isinstance(parsed, dict):
            parsed = parsed.get("memories")
        if not isinstance(parsed, list):
            return []

        result: list[MemoryCandidate] = []
        seen: set[str] = set()
        allowed_kinds = {
            "fact",
            "preference",
            "decision",
            "profile",
            "summary",
            "task",
        }
        for item in parsed:
            if not isinstance(item, dict):
                continue
            content = str(item.get("content", "")).strip()
            if not content or len(content) > 500:
                continue
            lowered = content.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            kind = str(item.get("kind", "fact")).lower()
            if kind not in allowed_kinds:
                kind = "fact"
            try:
                importance = float(item.get("importance", 0.5))
            except (TypeError, ValueError):
                importance = 0.5
            importance = max(0.0, min(1.0, importance))
            result.append(
                MemoryCandidate(  # type: ignore[arg-type]
                    content=content,
                    kind=kind,
                    importance=importance,
                )
            )
            if len(result) >= max(1, min(max_candidates, 10)):
                break
        return result

    async def embed(
        self, texts: Sequence[str], *, task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        vectors: list[list[float]] = []
        for offset in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = list(texts[offset : offset + EMBED_BATCH_SIZE])
            response = await self._embed_batch(batch, task_type)
            embeddings = response.embeddings or []
            batch_vectors = [
                [float(value) for value in (embedding.values or [])]
                for embedding in embeddings
            ]
            vectors.extend(batch_vectors)
        return validate_vectors(vectors, len(texts), self.embed_dim)

    async def _embed_batch(
        self, batch: list[str], task_type: TaskType
    ) -> types.EmbedContentResponse:
        for attempt in range(MAX_ATTEMPTS):
            try:
                return await self._client.aio.models.embed_content(
                    model=self.embed_model,
                    contents=batch,
                    config=types.EmbedContentConfig(
                        task_type=task_type,
                        output_dimensionality=self.embed_dim,
                    ),
                )
            except Exception as exc:
                mapped = map_provider_exception(exc)
                if mapped.retryable and attempt < MAX_ATTEMPTS - 1:
                    await self._sleep(BACKOFF_SECONDS[attempt])
                    continue
                raise mapped from exc
        raise ProviderError("provider_error", "Gemini embedding request failed.")

    async def health(self, *, force: bool = False) -> ProviderHealth:
        now = time.monotonic()
        if (
            not force
            and self._health_cache is not None
            and now - self._health_at < HEALTH_TTL_SECONDS
        ):
            return self._health_cache

        if not self._configured:
            status = ProviderHealth(
                name=self.name,
                configured=False,
                reachable=False,
                detail="GEMINI_API_KEY is not configured.",
                checked_at=utc_now(),
            )
        else:
            try:
                await asyncio.wait_for(
                    self._client.aio.models.get(model=self.chat_model), timeout=8.0
                )
                status = ProviderHealth(
                    name=self.name,
                    configured=True,
                    reachable=True,
                    detail="Gemini is reachable.",
                    checked_at=utc_now(),
                )
            except Exception as exc:
                mapped = map_provider_exception(exc)
                status = ProviderHealth(
                    name=self.name,
                    configured=True,
                    reachable=False,
                    detail=mapped.message,
                    checked_at=utc_now(),
                )
        self._health_cache = status
        self._health_at = now
        return status

    async def close(self) -> None:
        await self._client.aio.aclose()
