from __future__ import annotations

import numpy as np
import pytest

from app.llm.base import ChatTurn
from app.llm.embeddings import cosine, from_blob, is_stale_embedding, to_blob
from app.llm.jsonparse import parse_json_payload
from app.llm.mock import MockProvider


@pytest.mark.asyncio
async def test_mock_stream_is_labeled_and_consistent():
    provider = MockProvider(embed_dim=64)
    events = [
        event
        async for event in provider.stream_chat(
            system_instruction="be helpful",
            turns=[ChatTurn(role="user", text="Plan my week")],
        )
    ]
    assert events[0].kind == "thought"
    assert "mock mode" in events[0].text.lower()
    assert any(event.kind == "token" for event in events)
    done = events[-1]
    assert done.kind == "done"
    assert done.completion is not None
    assert done.completion.provider == "mock"
    assert done.completion.text.startswith("[Mock mode]")
    assert done.completion.text == "".join(
        event.text for event in events if event.kind == "token"
    )
    assert done.completion.usage["total_token_count"] > 0


@pytest.mark.asyncio
async def test_mock_embeddings_are_deterministic_and_semantic():
    provider = MockProvider(embed_dim=768)
    first, same, overlap, different = await provider.embed(
        [
            "I prefer short weekly plans",
            "I prefer short weekly plans",
            "I prefer short daily plans",
            "The weather in Cuttack is humid",
        ]
    )
    assert len(first) == 768
    assert first == same
    assert cosine(from_blob(to_blob(first)), from_blob(to_blob(same))) == pytest.approx(1.0)
    assert cosine(np.array(first), np.array(overlap)) > 0.5
    assert cosine(np.array(first), np.array(different)) < 0.3


@pytest.mark.asyncio
async def test_mock_extraction_finds_preference_and_fact():
    provider = MockProvider()
    candidates = await provider.extract_memories(
        user_text="I prefer short answers and I live in Bhubaneswar.",
        assistant_text="Understood.",
        max_candidates=5,
    )
    contents = {candidate.content.lower(): candidate for candidate in candidates}
    assert any("short answers" in content for content in contents)
    assert any("bhubaneswar" in content for content in contents)
    kinds = {candidate.kind for candidate in candidates}
    assert "preference" in kinds
    assert "fact" in kinds
    assert len(candidates) <= 5


@pytest.mark.asyncio
async def test_mock_health_is_explicit():
    status = await MockProvider().health()
    assert status.name == "mock"
    assert status.mock is True
    assert status.reachable is True
    assert "no network" in status.detail.lower()


def test_json_parser_tolerates_fences_and_prose():
    assert parse_json_payload('```json\n[{"a": 1}]\n```') == [{"a": 1}]
    assert parse_json_payload('Here you go: {"memories": []} thanks') == {"memories": []}
    assert parse_json_payload("not json") is None


def test_embedding_staleness():
    assert is_stale_embedding("old", 768, "new", 768)
    assert is_stale_embedding("same", 512, "same", 768)
    assert not is_stale_embedding("same", 768, "same", 768)
