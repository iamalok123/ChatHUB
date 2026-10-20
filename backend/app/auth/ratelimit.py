from __future__ import annotations

import time
from collections import deque

from app.errors import ApiError


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        events = self._events.setdefault(key, deque())
        while events and events[0] < cutoff:
            events.popleft()
        if len(events) >= self.limit:
            raise ApiError(
                429,
                "rate_limited",
                "Too many attempts. Wait a moment and try again.",
            )
        events.append(now)
