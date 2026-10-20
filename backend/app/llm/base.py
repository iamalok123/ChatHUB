from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from app.llm.health import ProviderHealth

Role = Literal["user", "assistant"]
TaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]
StreamKind = Literal["thought", "token", "done"]
MemoryKind = Literal["fact", "preference", "decision", "profile", "summary", "task"]


@dataclass(frozen=True)
class ChatTurn:
    role: Role
    text: str
    parts: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class MemoryCandidate:
    content: str
    kind: MemoryKind = "fact"
    importance: float = 0.5


@dataclass
class Completion:
    text: str
    thinking: str
    parts: list[dict[str, Any]] = field(default_factory=list)
    thought_signature: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    model: str = ""
    provider: str = ""
    finish_reason: str | None = None


@dataclass
class StreamEvent:
    kind: StreamKind
    text: str = ""
    completion: Completion | None = None


class ProviderError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        status_code: int | None = None,
        partial_text: str = "",
        partial_thinking: str = "",
        started: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status_code = status_code
        self.partial_text = partial_text
        self.partial_thinking = partial_thinking
        self.started = started

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "started": self.started,
        }


class LLMProvider(Protocol):
    name: str
    chat_model: str
    embed_model: str
    embed_dim: int

    def stream_chat(
        self,
        *,
        system_instruction: str,
        turns: Sequence[ChatTurn],
        thinking_level: str = "medium",
        model: str | None = None,
        max_output_tokens: int | None = None,
    ) -> AsyncIterator[StreamEvent]: ...

    async def generate_json(
        self,
        *,
        prompt: str,
        system_instruction: str = "",
        model: str | None = None,
        max_output_tokens: int = 1024,
    ) -> str: ...

    async def extract_memories(
        self,
        *,
        user_text: str,
        assistant_text: str,
        max_candidates: int = 5,
    ) -> list[MemoryCandidate]: ...

    async def embed(
        self, texts: Sequence[str], *, task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]: ...

    async def health(self, *, force: bool = False) -> ProviderHealth: ...

    async def close(self) -> None: ...
