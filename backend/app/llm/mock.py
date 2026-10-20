from __future__ import annotations

import hashlib
import re
from collections.abc import AsyncIterator, Sequence

import numpy as np

from app.clock import utc_now
from app.llm.base import (
    ChatTurn,
    Completion,
    LLMProvider,
    MemoryCandidate,
    StreamEvent,
    TaskType,
)
from app.llm.embeddings import validate_vectors
from app.llm.health import ProviderHealth

WORD_RE = re.compile(r"[a-z0-9']+", re.IGNORECASE)
SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "i",
    "in",
    "is",
    "it",
    "my",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "we",
    "with",
    "you",
}


def _tokenize(text: str) -> list[str]:
    return [token.lower() for token in WORD_RE.findall(text) if token.lower() not in STOPWORDS]


class MockProvider(LLMProvider):
    name = "mock"

    def __init__(self, embed_dim: int = 768) -> None:
        self.embed_dim = embed_dim
        self.chat_model = "mock"
        self.embed_model = f"mock-hash-{embed_dim}"

    def stream_chat(
        self,
        *,
        system_instruction: str,
        turns: Sequence[ChatTurn],
        thinking_level: str = "medium",
        model: str | None = None,
        max_output_tokens: int | None = None,
    ) -> AsyncIterator[StreamEvent]:
        del system_instruction, thinking_level, model, max_output_tokens
        return self._stream(turns)

    async def _stream(self, turns: Sequence[ChatTurn]) -> AsyncIterator[StreamEvent]:
        last_user = next((turn.text for turn in reversed(turns) if turn.role == "user"), "")
        excerpt = last_user.strip().replace("\n", " ")
        if len(excerpt) > 240:
            excerpt = excerpt[:237] + "..."

        thought = (
            "Context summary (mock mode): no live Gemini reasoning is available. "
            f"The latest user turn was {len(last_user.split())} words long. "
            "Requests are generated locally with deterministic output."
        )
        yield StreamEvent(kind="thought", text=thought)

        reply = (
            "[Mock mode] This reply was generated locally because GEMINI_API_KEY is "
            "not configured.\n\n"
            f'You said: "{excerpt}"\n\n'
            "Branching, inherited memory, and the reasoning inspector can be tested "
            "now. Add GEMINI_API_KEY to .env to use live Gemini answers."
        )
        for match in re.finditer(r"\S+\s*", reply):
            yield StreamEvent(kind="token", text=match.group(0))

        usage = {
            "prompt_token_count": max(1, len(last_user) // 4),
            "candidates_token_count": max(1, len(reply) // 4),
            "total_token_count": max(1, (len(last_user) + len(reply)) // 4),
        }
        completion = Completion(
            text=reply,
            thinking=thought,
            parts=[{"text": reply, "thought": False, "thought_signature": None}],
            usage=usage,
            model=self.chat_model,
            provider=self.name,
            finish_reason="STOP",
        )
        yield StreamEvent(kind="done", completion=completion)

    async def generate_json(
        self,
        *,
        prompt: str,
        system_instruction: str = "",
        model: str | None = None,
        max_output_tokens: int = 1024,
    ) -> str:
        del prompt, system_instruction, model, max_output_tokens
        return '{"mock": true, "message": "No Gemini key is configured."}'

    async def extract_memories(
        self,
        *,
        user_text: str,
        assistant_text: str,
        max_candidates: int = 5,
    ) -> list[MemoryCandidate]:
        del assistant_text
        candidates: list[MemoryCandidate] = []
        seen: set[str] = set()

        for sentence in SPLIT_RE.split(user_text):
            for clause in re.split(r"\s+and\s+", sentence, flags=re.IGNORECASE):
                content = clause.strip(" \t-*#").strip()
                if len(content) < 5 or len(content) > 400:
                    continue
                lowered = content.lower()
                kind = self._kind(lowered)
                if kind is None:
                    continue
                key = lowered.rstrip(".!?")
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(
                    MemoryCandidate(
                        content=content,
                        kind=kind,
                        importance=self._importance(kind),
                    )
                )
                if len(candidates) >= max_candidates:
                    return candidates
        return candidates

    @staticmethod
    def _kind(lowered: str) -> str | None:
        if re.search(r"\b(i prefer|i like|i love|i hate|i dislike)\b", lowered):
            return "preference"
        if re.search(r"\b(my goal|my name is|i am a|i work as)\b", lowered):
            return "profile"
        if re.search(r"\b(i decided|we decided|we will|i will go with)\b", lowered):
            return "decision"
        if re.search(r"\b(remind me|remember to|i need to|todo|to-do)\b", lowered):
            return "task"
        if re.search(
            r"\b(i live|i live in|i have|i use|i work|i'm based|i am based)\b",
            lowered,
        ):
            return "fact"
        return None

    @staticmethod
    def _importance(kind: str) -> float:
        return {
            "preference": 0.7,
            "profile": 0.8,
            "decision": 0.75,
            "task": 0.6,
            "fact": 0.55,
            "summary": 0.5,
        }.get(kind, 0.5)

    async def embed(
        self, texts: Sequence[str], *, task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        del task_type
        vectors = [self._embed_one(text) for text in texts]
        return validate_vectors(vectors, len(texts), self.embed_dim)

    def _embed_one(self, text: str) -> list[float]:
        vector = np.zeros(self.embed_dim, dtype=np.float32)
        tokens = _tokenize(text)
        if not tokens:
            tokens = [text.strip().lower() or "empty"]

        for token in tokens:
            self._add_feature(vector, token, 1.0)
        for left, right in zip(tokens, tokens[1:], strict=False):
            self._add_feature(vector, f"{left} {right}", 0.5)

        norm = float(np.linalg.norm(vector))
        if norm == 0.0:
            vector[0] = 1.0
        else:
            vector /= norm
        return [float(value) for value in vector]

    def _add_feature(self, vector: np.ndarray, feature: str, weight: float) -> None:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % self.embed_dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign * weight

    async def health(self, *, force: bool = False) -> ProviderHealth:
        del force
        return ProviderHealth(
            name=self.name,
            configured=False,
            reachable=True,
            detail="Mock provider active; no network AI calls are made.",
            checked_at=utc_now(),
            mock=True,
        )

    async def close(self) -> None:
        return None
