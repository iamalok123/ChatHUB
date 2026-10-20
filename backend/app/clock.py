from __future__ import annotations

import uuid
from datetime import UTC, datetime


def utc_now() -> str:
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def new_id() -> str:
    return str(uuid.uuid4())
