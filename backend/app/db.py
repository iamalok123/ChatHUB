from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
PG_SCHEMA_PATH = Path(__file__).with_name("schema_pg.sql")


class PostgresRow(dict):
    """Row object that supports both dict key access and integer indexing (row[0]),
    providing 100% compatibility with sqlite3.Row."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class PostgresCursorWrapper:
    def __init__(self, cur: Any) -> None:
        self._cur = cur

    def fetchone(self) -> PostgresRow | None:
        res = self._cur.fetchone()
        return PostgresRow(res) if res is not None else None

    def fetchall(self) -> list[PostgresRow]:
        return [PostgresRow(r) for r in self._cur.fetchall()]

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def __iter__(self) -> Any:
        for r in self._cur:
            yield PostgresRow(r)


class PostgresConnectionWrapper:
    """Wraps a psycopg3 connection to provide SQLite-like execution ergonomics."""

    def __init__(self, raw_conn: Any) -> None:
        self._conn = raw_conn

    def execute(self, sql: str, params: tuple | list | None = None) -> PostgresCursorWrapper:
        # Translate SQLite ? parameter placeholders to PostgreSQL %s
        pg_sql = sql.replace("?", "%s")
        cur = self._conn.execute(pg_sql, params or ())
        return PostgresCursorWrapper(cur)

    def executescript(self, script: str) -> None:
        self._conn.execute(script)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> PostgresConnectionWrapper:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is not None:
            self._conn.rollback()
        else:
            self._conn.commit()


class Database:
    def __init__(self, path: Path, database_url: str = "") -> None:
        self.path = Path(path)
        self.database_url = database_url
        self._sqlite_schema = SCHEMA_PATH.read_text(encoding="utf-8")
        self._pg_schema = PG_SCHEMA_PATH.read_text(encoding="utf-8")

    @property
    def is_postgres(self) -> bool:
        return bool(
            self.database_url.startswith("postgresql://")
            or self.database_url.startswith("postgres://")
        )

    def initialize(self) -> None:
        from app.migrations import apply_migrations

        if not self.is_postgres:
            self.path.parent.mkdir(parents=True, exist_ok=True)

        conn = self.connect()
        try:
            apply_migrations(conn, is_postgres=self.is_postgres, db_path=self.path)
            conn.commit()
        finally:
            conn.close()

    def connect(self) -> sqlite3.Connection | PostgresConnectionWrapper:
        if self.is_postgres:
            import psycopg
            from psycopg.rows import dict_row

            raw_conn = psycopg.connect(self.database_url, row_factory=dict_row)
            return PostgresConnectionWrapper(raw_conn)
        else:
            conn = sqlite3.connect(self.path, timeout=5.0, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA busy_timeout = 5000")
            return conn

    @contextmanager
    def session(self) -> Iterator[sqlite3.Connection | PostgresConnectionWrapper]:
        conn = self.connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()
