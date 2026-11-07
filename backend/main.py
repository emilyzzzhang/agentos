"""AgentOS backend entrypoint: `uvicorn main:app --reload --port 8000` (single worker).

Requires PostgreSQL (migrated with `alembic upgrade head`). Qdrant and the embedding model are
needed only for the Knowledge Library; if they are unavailable, web research still works.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.documents import router as documents_router
from api.manager import Deps, RunManager, live_deps
from api.routes import router
from config import Settings, get_settings
from db.missions import MissionStore
from db.session import Database
from events import LibraryEventBus
from rag.documents import DocumentService
from rag.knowledge import KnowledgeBase
from storage.files import FileStorage, LocalFileStorage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agentos")


def create_app(settings: Settings | None = None, deps: Deps = live_deps, *, kb: KnowledgeBase | None = None,
               storage: FileStorage | None = None, create_schema: bool = False) -> FastAPI:
    """`kb`, `storage` and `create_schema` exist for tests (in-memory Qdrant, SQLite)."""
    settings = settings or get_settings()
    db = Database(settings.database_url)
    kb = kb or KnowledgeBase(settings)
    bus = LibraryEventBus()
    documents = DocumentService(settings, db, storage or LocalFileStorage(settings.upload_dir), kb, bus)
    missions = MissionStore(db)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        if create_schema:
            await db.create_all()
        await db.check()  # fail fast: PostgreSQL is required
        await db.ensure_workspace(settings.workspace_id)
        if n := await app.state.runs.recover():
            log.warning("marked %d mission(s) interrupted by the previous shutdown", n)
        kb_task = asyncio.create_task(kb.start(), name="knowledge-start")
        requeued = await documents.recover()  # ingestion waits until the knowledge base is ready
        if requeued:
            log.info("re-queued %d document(s) for indexing", requeued)
        try:
            yield
        finally:
            await app.state.runs.shutdown()
            await documents.shutdown()
            kb_task.cancel()
            await asyncio.gather(kb_task, return_exceptions=True)
            kb.close()
            await db.close()

    app = FastAPI(title="AgentOS", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db
    app.state.kb = kb
    app.state.library_events = bus
    app.state.documents = documents
    app.state.missions = missions
    app.state.runs = RunManager(settings, deps, store=missions, documents=documents, kb=kb)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                       allow_headers=["*"], expose_headers=["*"])
    app.include_router(router)
    app.include_router(documents_router)
    return app


app = create_app()
