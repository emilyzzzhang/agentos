"""Async engine and session factory. The URL comes from settings (AGENTOS_DATABASE_URL)."""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .models import Base, Workspace


class DatabaseError(RuntimeError):
    pass


def _redact(url: str) -> str:
    return sa.make_url(url).render_as_string(hide_password=True)


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        kwargs = {} if url.startswith("sqlite") else {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5}
        self.engine: AsyncEngine = create_async_engine(url, **kwargs)
        if url.startswith("sqlite"):
            @event.listens_for(self.engine.sync_engine, "connect")
            def _fk_on(dbapi_conn, _):  # SQLite ignores ON DELETE without this
                dbapi_conn.execute("PRAGMA foreign_keys=ON")
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def check(self) -> None:
        """Fail fast with an actionable message if the database is unreachable or not migrated."""
        try:
            async with self.engine.connect() as conn:
                await conn.execute(sa.text("SELECT 1"))
        except Exception as exc:
            raise DatabaseError(
                f"Cannot connect to the database at {_redact(self.url)} ({type(exc).__name__}). "
                "Start it with `docker compose up -d` from the repository root.") from exc
        try:
            async with self.engine.connect() as conn:
                await conn.execute(sa.select(Workspace.id).limit(1))
        except Exception as exc:
            raise DatabaseError("The database schema is missing or outdated. "
                                "Run `.venv/bin/alembic upgrade head` in backend/.") from exc

    async def ensure_workspace(self, workspace_id: str, name: str = "Local workspace") -> None:
        async with self.sessions() as s:
            if await s.get(Workspace, workspace_id) is None:
                s.add(Workspace(id=workspace_id, name=name))
                await s.commit()

    async def create_all(self) -> None:
        """Tests only. The application uses Alembic migrations."""
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def close(self) -> None:
        await self.engine.dispose()
