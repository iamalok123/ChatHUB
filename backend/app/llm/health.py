from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderHealth:
    name: str
    configured: bool
    reachable: bool | None
    detail: str
    checked_at: str | None = None
    mock: bool = False

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "configured": self.configured,
            "reachable": self.reachable,
            "detail": self.detail,
            "checked_at": self.checked_at,
            "mock": self.mock,
        }
