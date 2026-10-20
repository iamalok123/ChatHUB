from __future__ import annotations

import logging
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("chathub.migrations")

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def get_applied_migrations(conn: Any) -> set[str]:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    rows = conn.execute("SELECT id FROM schema_migrations").fetchall()
    return {row[0] if isinstance(row, tuple) else row["id"] for row in rows}


def record_migration(conn: Any, migration_id: str, name: str) -> None:
    now = datetime.now(UTC).isoformat()
    conn.execute(
        "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
        (migration_id, name, now),
    )
    conn.commit()


def backup_sqlite_db(db_path: Path) -> Path | None:
    if not db_path.exists():
        return None
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"{db_path.stem}_{timestamp}.bak"
    shutil.copy2(db_path, backup_path)
    logger.info("Created pre-migration backup at: %s", backup_path)
    return backup_path


def apply_migrations(conn: Any, *, is_postgres: bool, db_path: Path | None = None) -> list[str]:
    applied = get_applied_migrations(conn)
    suffix = "_pg.sql" if is_postgres else "_sqlite.sql"
    migration_files = sorted(MIGRATIONS_DIR.glob(f"*{suffix}"))

    newly_applied: list[str] = []

    for file_path in migration_files:
        # Extract migration ID, e.g. '0001' from '0001_initial_sqlite.sql'
        match = re.match(r"^(\d+)_(.*)$", file_path.name)
        if not match:
            continue
        migration_id = match.group(1)
        migration_name = match.group(2).replace(suffix, "")

        if migration_id in applied:
            continue

        if not is_postgres and db_path and not newly_applied:
            backup_sqlite_db(db_path)

        logger.info("Applying migration %s (%s)...", migration_id, migration_name)
        sql_content = file_path.read_text(encoding="utf-8")

        if is_postgres:
            conn.executescript(sql_content)
        else:
            conn.executescript(sql_content)

        record_migration(conn, migration_id, migration_name)
        newly_applied.append(f"{migration_id}_{migration_name}")
        logger.info("Successfully applied migration %s.", migration_id)

    return newly_applied
