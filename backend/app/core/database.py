"""SQLAlchemy database setup."""

from __future__ import annotations

import logging
from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    settings.ensure_dirs()
    url = f"sqlite:///{settings.db_path}"
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_columns() -> None:
    """Add new columns to existing SQLite tables (create_all does not alter)."""
    migrations: list[tuple[str, str, str]] = [
        ("drive_accounts", "provider", "VARCHAR(32) DEFAULT 'drive'"),
        ("drive_accounts", "onedrive_drive_id", "VARCHAR(128)"),
        ("drive_accounts", "onedrive_drive_type", "VARCHAR(64)"),
        ("drive_accounts", "webdav_url", "VARCHAR(512)"),
        ("drive_accounts", "webdav_vendor", "VARCHAR(64)"),
        ("oauth_states", "provider", "VARCHAR(32) DEFAULT 'drive'"),
    ]
    with engine.begin() as conn:
        for table, column, col_type in migrations:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                logger.info("Migrated %s.%s", table, column)
        # Normalize null provider on old rows
        try:
            conn.execute(
                text(
                    "UPDATE drive_accounts SET provider = 'drive' "
                    "WHERE provider IS NULL OR provider = ''"
                )
            )
        except Exception:
            pass


def init_db() -> None:
    # Import models so metadata is registered
    from app.models import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_columns()
