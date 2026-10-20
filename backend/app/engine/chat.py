from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import sqlite3
import time
from collections.abc import AsyncIterator
from typing import Any

from app.clock import utc_now
from app.config import Settings
from app.db import Database
from app.engine.context import ComposedContext
from app.engine.extraction import ExtractionResult, MemoryExtractor
from app.llm.base import Completion, LLMProvider, ProviderError, StreamEvent
from app.repo import commits

logger = logging.getLogger("branchmind.chat")

HEARTBEAT_SECONDS = 10.0
TRACE_VERSION = 1


def sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class ChatStreamer:
    def __init__(
        self,
        *,
        database: Database,
        provider: LLMProvider,
        settings: Settings,
        branch: sqlite3.Row,
        space: sqlite3.Row,
        context: ComposedContext,
        assistant_commit_id: str,
        current_user_commit_id: str | None,
        initial_steps: list[dict[str, Any]],
        regenerated_from: str | None = None,
        branch_event: dict[str, str] | None = None,
        retrieval: dict[str, Any] | None = None,
        current_user_text: str = "",
        extractor: MemoryExtractor | None = None,
    ) -> None:
        self.database = database
        self.provider = provider
        self.settings = settings
        self.branch = branch
        self.space = space
        self.context = context
        self.assistant_commit_id = assistant_commit_id
        self.current_user_commit_id = current_user_commit_id
        self.initial_steps = initial_steps
        self.regenerated_from = regenerated_from
        self.branch_event = branch_event
        self.retrieval = retrieval or {}
        self.current_user_text = current_user_text
        self.extractor = extractor
        self.last_trace: dict[str, Any] | None = None

    async def stream(self) -> AsyncIterator[str]:
        if self.branch_event:
            yield sse("branch", self.branch_event)

        for step in self.initial_steps:
            yield sse("step", step)

        text_parts: list[str] = []
        thinking_parts: list[str] = []
        completion: Completion | None = None
        error: ProviderError | None = None
        finalized = False
        stream_ended = False
        generate_started = time.perf_counter()

        yield sse(
            "step",
            {
                "phase": "generate",
                "status": "running",
                "duration_ms": 0,
                "payload": {
                    "provider": self.provider.name,
                    "model": self.branch["model"] or self.provider.chat_model,
                },
            },
        )

        queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()

        async def pump() -> None:
            try:
                async for event in self.provider.stream_chat(
                    system_instruction=self.context.system_instruction,
                    turns=self.context.turns,
                    thinking_level=self.branch["thinking_level"],
                    model=self.branch["model"],
                ):
                    await queue.put(("event", event))
            except ProviderError as exc:
                await queue.put(("provider_error", exc))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Provider stream failed: %s", type(exc).__name__)
                mapped = ProviderError("provider_error", "The AI provider failed unexpectedly.")
                await queue.put(("provider_error", mapped))
            finally:
                await queue.put(("end", None))

        task = asyncio.create_task(pump())
        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if kind == "event":
                    event = payload
                    assert isinstance(event, StreamEvent)
                    if event.kind == "thought":
                        thinking_parts.append(event.text)
                        yield sse("thinking", {"text": event.text, "synthetic": False})
                    elif event.kind == "token":
                        text_parts.append(event.text)
                        yield sse("token", {"text": event.text})
                    elif event.kind == "done":
                        completion = event.completion
                elif kind == "provider_error":
                    error = payload  # type: ignore[assignment]
                elif kind == "end":
                    stream_ended = True
                    break
        finally:
            if not finalized and not stream_ended:
                self._finalize(
                    text="".join(text_parts),
                    thinking="".join(thinking_parts),
                    completion=completion,
                    error=error
                    or ProviderError(
                        "client_disconnected",
                        "The client disconnected before the reply finished.",
                    ),
                    generate_started=generate_started,
                    cancelled=True,
                )
                finalized = True
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        generate_ms = int((time.perf_counter() - generate_started) * 1000)
        if error is not None:
            final_step = {
                "phase": "generate",
                "status": "error",
                "duration_ms": generate_ms,
                "payload": {"provider": self.provider.name, "error": error.code},
            }
            status = self._finalize(
                text="".join(text_parts),
                thinking="".join(thinking_parts),
                completion=completion,
                error=error,
                generate_started=generate_started,
                final_step=final_step,
            )
            finalized = True
            yield sse("step", final_step)
            yield sse(
                "error",
                {
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable,
                    "partial_commit_id": self.assistant_commit_id,
                    "status": status,
                },
            )
            return

        answer = completion.text if completion is not None else "".join(text_parts)
        thinking = completion.thinking if completion is not None else "".join(thinking_parts)
        if completion is None:
            error = ProviderError(
                "empty_response",
                "The AI provider ended without completing the reply.",
                partial_text=answer,
                partial_thinking=thinking,
                started=bool(answer),
            )
            final_step = {
                "phase": "generate",
                "status": "error",
                "duration_ms": generate_ms,
                "payload": {"provider": self.provider.name, "error": error.code},
            }
            status = self._finalize(
                text=answer,
                thinking=thinking,
                completion=None,
                error=error,
                generate_started=generate_started,
                final_step=final_step,
            )
            finalized = True
            yield sse("step", final_step)
            yield sse(
                "error",
                {
                    "code": error.code,
                    "message": error.message,
                    "retryable": False,
                    "partial_commit_id": self.assistant_commit_id,
                    "status": status,
                },
            )
            return

        if completion.finish_reason == "BLOCKED" and not answer:
            blocked = ProviderError(
                "blocked", "The AI provider blocked this reply.", retryable=False
            )
            final_step = {
                "phase": "generate",
                "status": "error",
                "duration_ms": generate_ms,
                "payload": {"provider": self.provider.name, "error": blocked.code},
            }
            status = self._finalize(
                text=answer,
                thinking=thinking,
                completion=completion,
                error=blocked,
                generate_started=generate_started,
                final_step=final_step,
            )
            finalized = True
            yield sse("step", final_step)
            yield sse(
                "error",
                {
                    "code": blocked.code,
                    "message": blocked.message,
                    "retryable": False,
                    "partial_commit_id": self.assistant_commit_id,
                    "status": status,
                },
            )
            return

        if not answer.strip():
            empty = ProviderError(
                "empty_response",
                "The AI provider returned an empty reply.",
                partial_thinking=thinking,
                retryable=False,
            )
            final_step = {
                "phase": "generate",
                "status": "error",
                "duration_ms": generate_ms,
                "payload": {"provider": self.provider.name, "error": empty.code},
            }
            status = self._finalize(
                text=answer,
                thinking=thinking,
                completion=completion,
                error=empty,
                generate_started=generate_started,
                final_step=final_step,
            )
            finalized = True
            yield sse("step", final_step)
            yield sse(
                "error",
                {
                    "code": empty.code,
                    "message": empty.message,
                    "retryable": False,
                    "partial_commit_id": self.assistant_commit_id,
                    "status": status,
                },
            )
            return

        synthetic = False
        if not thinking.strip():
            thinking = (
                "Context summary (not model reasoning): "
                f"{self.context.stats['history_messages']} history messages, "
                f"{self.context.stats['memory_count']} memories, "
                f"{self.context.stats['total_tokens']} composed tokens."
            )
            synthetic = True
            yield sse("thinking", {"text": thinking, "synthetic": True})
        elif not thinking_parts:
            yield sse("thinking", {"text": thinking, "synthetic": False})

        final_step = {
            "phase": "generate",
            "status": "done",
            "duration_ms": generate_ms,
            "payload": {
                "provider": self.provider.name,
                "model": completion.model,
                "usage": completion.usage,
            },
        }
        status = self._finalize(
            text=answer,
            thinking=thinking,
            completion=completion,
            error=None,
            generate_started=generate_started,
            final_step=final_step,
            thinking_source="synthetic_context" if synthetic else "model",
        )
        finalized = True
        yield sse("step", final_step)

        if self.extractor is not None and answer and status == "complete":
            yield sse(
                "step",
                {
                    "phase": "extract",
                    "status": "running",
                    "duration_ms": 0,
                    "payload": {"mode": self.branch["memory_mode"]},
                },
            )
            try:
                extraction = await self.extractor.extract(
                    branch_id=self.branch["id"],
                    assistant_commit_id=self.assistant_commit_id,
                    user_text=self.current_user_text,
                    assistant_text=answer,
                )
            except Exception:
                logger.exception("Memory extraction crashed")
                extraction = ExtractionResult(
                    mode=self.branch["memory_mode"],
                    status="error",
                    operations=[{"op": "extraction_error", "code": "internal_error"}],
                    warnings=["Memory extraction failed unexpectedly."],
                )
            extract_step = {
                "phase": "extract",
                "status": extraction.status,
                "duration_ms": extraction.duration_ms,
                "payload": {
                    "mode": extraction.mode,
                    "proposals": len(extraction.proposals),
                    "auto_saved": len(extraction.auto_saved),
                    "warnings": extraction.warnings,
                },
            }
            self._record_extraction(extraction, extract_step)
            yield sse("step", extract_step)
            if extraction.proposals or extraction.auto_saved:
                yield sse(
                    "proposals",
                    {
                        "mode": extraction.mode,
                        "proposals": extraction.proposals,
                        "auto_saved": extraction.auto_saved,
                    },
                )

        yield sse(
            "done",
            {
                "user_commit_id": self.current_user_commit_id,
                "assistant_commit_id": self.assistant_commit_id,
                "head_commit_id": self.assistant_commit_id,
                "usage": completion.usage,
                "duration_ms": int((time.perf_counter() - generate_started) * 1000),
                "trace_version": TRACE_VERSION,
                "status": status,
                "provider": self.provider.name,
            },
        )

    def _finalize(
        self,
        *,
        text: str,
        thinking: str,
        completion: Completion | None,
        error: ProviderError | None,
        generate_started: float,
        final_step: dict[str, Any] | None = None,
        thinking_source: str | None = None,
        cancelled: bool = False,
    ) -> str:
        answer = (completion.text if completion is not None else text) or text
        model_thinking = (
            completion.thinking if completion is not None and completion.thinking else thinking
        )
        if error is not None:
            answer = error.partial_text or answer
            model_thinking = error.partial_thinking or model_thinking
            status = "partial" if answer or model_thinking else "error"
        elif answer:
            status = "complete"
        else:
            status = "error"

        if thinking_source is None:
            thinking_source = "model" if model_thinking else None
        if cancelled and error is not None:
            error_code = "client_disconnected"
        elif error is not None:
            error_code = error.code
        else:
            error_code = None

        steps = [*self.initial_steps]
        if final_step is not None:
            steps.append(final_step)

        retrieval_warnings = list(self.retrieval.get("warnings", []))
        trace = {
            "version": TRACE_VERSION,
            "provider": self.provider.name,
            "mock": self.provider.name == "mock",
            "model": (
                completion.model
                if completion is not None
                else (self.branch["model"] or self.provider.chat_model)
            ),
            "thinking_level": self.branch["thinking_level"],
            "thinking_summary": model_thinking,
            "thinking_source": thinking_source,
            "context": self.context.stats,
            "memory_mode": self.branch["memory_mode"],
            "retrieval": {
                "query": self.retrieval.get("query", ""),
                "query_tokens": self.retrieval.get("query_tokens", 0),
                "used_tokens": self.retrieval.get("used_tokens", 0),
                "top_k": self.retrieval.get("top_k", self.branch["top_k"]),
                "duration_ms": self.retrieval.get("duration_ms", 0),
            },
            "retrieved_memories": self.retrieval.get("selected", []),
            "considered_memories": self.retrieval.get("considered", []),
            "excluded_memories": self.retrieval.get("excluded", []),
            "memory_operations": [],
            "warnings": retrieval_warnings,
            "usage": completion.usage if completion is not None else {},
            "finish_reason": completion.finish_reason if completion is not None else None,
            "steps": steps,
            "error": error.to_dict() if error is not None else None,
            "error_code": error_code,
            "regenerated_from": self.regenerated_from,
            "current_user_commit_id": self.current_user_commit_id,
            "assistant_commit_id": self.assistant_commit_id,
            "status": status,
            "completed_at": utc_now(),
            "generate_ms": int((time.perf_counter() - generate_started) * 1000),
        }

        parts_json = (
            json.dumps(completion.parts, ensure_ascii=False)
            if completion is not None and completion.parts
            else None
        )
        usage_json = (
            json.dumps(completion.usage, separators=(",", ":")) if completion is not None else None
        )
        stored_thinking = (
            None if thinking_source == "synthetic_context" else (model_thinking or None)
        )
        self.last_trace = trace
        try:
            conn = self.database.connect()
            try:
                commits.update_payload(
                    conn,
                    self.assistant_commit_id,
                    content=answer,
                    thinking=stored_thinking,
                    trace_json=json.dumps(trace, ensure_ascii=False, separators=(",", ":")),
                    status=status,
                    provider_parts_json=parts_json,
                    thought_signature=(
                        completion.thought_signature if completion is not None else None
                    ),
                    usage_json=usage_json,
                )
            finally:
                conn.close()
        except Exception:
            logger.exception("Failed to persist assistant commit %s", self.assistant_commit_id)
        return status

    def _record_extraction(
        self, extraction: ExtractionResult, extract_step: dict[str, Any]
    ) -> None:
        trace = self.last_trace
        if trace is None:
            return
        trace["memory_mode"] = extraction.mode
        trace["memory_operations"] = extraction.operations
        trace["steps"] = [*trace.get("steps", []), extract_step]
        trace["extraction"] = {
            "status": extraction.status,
            "mode": extraction.mode,
            "proposals": len(extraction.proposals),
            "auto_saved": len(extraction.auto_saved),
        }
        warnings = list(trace.get("warnings", []))
        for warning in extraction.warnings:
            if warning not in warnings:
                warnings.append(warning)
        trace["warnings"] = warnings
        try:
            conn = self.database.connect()
            try:
                commits.update_trace(
                    conn,
                    self.assistant_commit_id,
                    trace_json=json.dumps(trace, ensure_ascii=False, separators=(",", ":")),
                )
            finally:
                conn.close()
        except Exception:
            logger.exception(
                "Failed to update extraction trace for %s",
                self.assistant_commit_id,
            )
