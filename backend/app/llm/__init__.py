from __future__ import annotations

from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.gemini import GeminiProvider
from app.llm.mock import MockProvider


def build_provider(settings: Settings) -> LLMProvider:
    if settings.effective_llm_mode == "mock":
        return MockProvider(embed_dim=settings.gemini_embed_dim)
    return GeminiProvider(settings)
