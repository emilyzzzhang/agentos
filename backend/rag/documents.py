"""Knowledge Library documents: upload, background ingestion, deletion and lookups.

Ingestion: stored file -> parse -> clean -> chunk -> embed + index in Qdrant -> chunks + status in PostgreSQL.
Parsing and embedding run in worker threads, limited by AGENTOS_INGEST_CONCURRENCY. Documents left
`pending` or `processing` by a restart are re-queued by `recover()`. Failures set status `failed`
with an error message.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from config import Settings
from db.models import Document, DocumentChunk, MissionEvidence
from db.session import Database
from events import EventType, LibraryEventBus
from storage.files import FileStorage

from .chunking import chunk_sections
from .knowledge import KnowledgeBase, KnowledgeUnavailable
from .parsing import CONTENT_TYPES, ParseError, detect_file_type, parse_document, safe_filename
from .vector_store import IndexedChunk

log = logging.getLogger(__name__)


class DocumentNotFound(LookupError):
    pass


class DuplicateDocument(ValueError):
    def __init__(self, existing: Document) -> None:
        super().__init__(f"This file is already in the library as {existing.filename!r}.")
        self.existing = existing


class TooManyPending(RuntimeError):
    pass


def document_to_dict(d: Document, kb: KnowledgeBase | None = None) -> dict[str, Any]:
    stale = bool(kb and d.status == "ready" and kb.index and not kb.is_current(d.embedding_model, d.embedding_dim))
    return {
        "id": d.id, "workspace_id": d.workspace_id, "filename": d.filename, "title": d.title,
        "file_type": d.file_type, "content_type": d.content_type, "size_bytes": d.size_bytes, "sha256": d.sha256,
        "status": d.status, "error": d.error, "page_count": d.page_count, "chunk_count": d.chunk_count,
        "embedding_model": d.embedding_model, "embedding_dim": d.embedding_dim,
        "chunk_size": d.chunk_size, "chunk_overlap": d.chunk_overlap,
        "created_at": d.created_at, "updated_at": d.updated_at, "indexed_at": d.indexed_at,
        # Indexed with a different embedding model than the one configured now: needs reindexing.
        "needs_reindex": stale,
    }


def chunk_to_dict(c: DocumentChunk, d: Document) -> dict[str, Any]:
    return {"chunk_id": c.id, "document_id": d.id, "filename": d.filename, "title": d.title, "file_type": d.file_type,
            "chunk_index": c.chunk_index, "page": c.page, "section": c.section, "text": c.text}


class DocumentService:
    def __init__(self, settings: Settings, db: Database, storage: FileStorage, kb: KnowledgeBase,
                 bus: LibraryEventBus) -> None:
        self.settings = settings
        self.db = db
        self.storage = storage
        self.kb = kb
        self.bus = bus
        self._sem = asyncio.Semaphore(max(1, settings.ingest_concurrency))
        self._tasks: dict[str, asyncio.Task] = {}

    # ---------- queries (always workspace-scoped) ----------

    async def list(self, workspace_id: str) -> list[Document]:
        async with self.db.sessions() as s:
            rows = await s.execute(sa.select(Document).where(Document.workspace_id == workspace_id)
                                   .order_by(Document.created_at.desc()))
            return list(rows.scalars())

    async def get(self, workspace_id: str, document_id: str) -> Document:
        async with self.db.sessions() as s:
            doc = (await s.execute(sa.select(Document).where(
                Document.id == document_id, Document.workspace_id == workspace_id))).scalar_one_or_none()
        if doc is None:
            raise DocumentNotFound(document_id)
        return doc

    async def get_chunk(self, workspace_id: str, document_id: str, chunk_id: str) -> dict[str, Any]:
        async with self.db.sessions() as s:
            row = (await s.execute(sa.select(DocumentChunk, Document).join(Document).where(
                DocumentChunk.id == chunk_id, Document.id == document_id,
                Document.workspace_id == workspace_id))).first()
        if row is None:
            raise DocumentNotFound(chunk_id)
        return chunk_to_dict(*row)

    async def ready_documents(self, workspace_id: str, ids: list[str] | None = None) -> list[Document]:
        """Documents that retrieval can use now: indexed, in this workspace, with the current embedding model."""
        async with self.db.sessions() as s:
            q = sa.select(Document).where(Document.workspace_id == workspace_id, Document.status == "ready")
            if ids is not None:
                q = q.where(Document.id.in_(ids))
            docs = list((await s.execute(q.order_by(Document.created_at))).scalars())
        return [d for d in docs if self.kb.is_current(d.embedding_model, d.embedding_dim)]

    # ---------- upload ----------

    async def upload(self, workspace_id: str, filename: str, data: bytes) -> Document:
        name = safe_filename(filename)
        file_type = detect_file_type(name, data)  # raises UnsupportedFile
        if not data.strip():
            raise ParseError("The file is empty.")
        if self.kb.status == "unavailable":
            raise KnowledgeUnavailable(f"The Knowledge Library is unavailable: {self.kb.error}")
        digest = hashlib.sha256(data).hexdigest()
        async with self.db.sessions() as s:
            existing = (await s.execute(sa.select(Document).where(
                Document.workspace_id == workspace_id, Document.sha256 == digest))).scalar_one_or_none()
            if existing:
                raise DuplicateDocument(existing)
            pending = await s.scalar(sa.select(sa.func.count()).select_from(Document).where(
                Document.workspace_id == workspace_id, Document.status.in_(("pending", "processing"))))
            if (pending or 0) >= self.settings.max_pending_documents:
                raise TooManyPending(f"{pending} documents are waiting to be indexed. Try again later.")

        doc_id = f"doc_{uuid4().hex[:16]}"
        ext = {"pdf": "pdf", "markdown": "md", "text": "txt"}[file_type]
        key = f"{workspace_id}/{doc_id}/original.{ext}"
        await asyncio.to_thread(self.storage.put, key, data)
        doc = Document(id=doc_id, workspace_id=workspace_id, filename=name, title=PurePath(name).stem[:255] or name,
                       file_type=file_type, content_type=CONTENT_TYPES[file_type], size_bytes=len(data), sha256=digest,
                       storage_key=key, status="pending", chunk_count=0)
        try:
            async with self.db.sessions() as s:
                s.add(doc)
                await s.commit()
        except IntegrityError:  # concurrent upload of the same bytes
            await asyncio.to_thread(self.storage.delete, key)
            async with self.db.sessions() as s:
                existing = (await s.execute(sa.select(Document).where(
                    Document.workspace_id == workspace_id, Document.sha256 == digest))).scalar_one()
            raise DuplicateDocument(existing)
        await self.bus.emit(workspace_id, EventType.DOCUMENT_UPLOADED, {
            "document_id": doc.id, "filename": doc.filename, "file_type": file_type, "size_bytes": doc.size_bytes,
            "status": "pending"})
        self.schedule(workspace_id, doc.id)
        return doc

    # ---------- ingestion ----------

    def schedule(self, workspace_id: str, document_id: str) -> None:
        if (t := self._tasks.get(document_id)) and not t.done():
            return
        task = asyncio.create_task(self._ingest(workspace_id, document_id), name=f"ingest:{document_id}")
        self._tasks[document_id] = task
        task.add_done_callback(lambda t, d=document_id: self._tasks.pop(d, None) if self._tasks.get(d) is t else None)

    async def _set(self, document_id: str, **values: Any) -> None:
        async with self.db.sessions() as s:
            await s.execute(sa.update(Document).where(Document.id == document_id).values(
                updated_at=datetime.now(timezone.utc), **values))
            await s.commit()

    async def _ingest(self, workspace_id: str, document_id: str) -> None:
        async with self._sem:
            try:
                doc = await self.get(workspace_id, document_id)
            except DocumentNotFound:
                return  # deleted while queued
            if not await self.kb.wait_ready(timeout=600):
                await self._fail(workspace_id, doc, "The Knowledge Library is unavailable: "
                                 + (self.kb.error or "embedding model or Qdrant did not start in time"))
                return
            index, _ = self.kb.require()
            started = time.monotonic()
            await self._set(document_id, status="processing", error=None)
            await self.bus.emit(workspace_id, EventType.DOCUMENT_INDEXING_STARTED, {
                "document_id": doc.id, "filename": doc.filename, "status": "processing"})
            try:
                s = self.settings
                data = await asyncio.to_thread(self.storage.get, doc.storage_key)
                parsed = await asyncio.to_thread(parse_document, data, doc.file_type, max_pages=s.max_pdf_pages)
                chunks = await asyncio.to_thread(chunk_sections, parsed.sections, chunk_size=s.chunk_size,
                                                 chunk_overlap=s.chunk_overlap)
                if not chunks:
                    raise ParseError("No text could be extracted from the document.")
                title = (parsed.title or doc.title)[:255]
                indexed = [IndexedChunk(chunk_id=c.chunk_id(doc.id), text=c.text, metadata={
                    "workspace_id": workspace_id, "document_id": doc.id, "chunk_id": c.chunk_id(doc.id),
                    "chunk_index": c.index, "filename": doc.filename, "title": title, "file_type": doc.file_type,
                    "page": c.page, "section": c.section}) for c in chunks]
                # Replace any vectors from an earlier attempt or an older embedding model.
                await self._delete_vectors(workspace_id, doc)
                await asyncio.to_thread(index.add, indexed)  # embeds with the shared model, then upserts
                async with self.db.sessions() as sess:
                    await sess.execute(sa.delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
                    sess.add_all([DocumentChunk(id=c.chunk_id(doc.id), document_id=doc.id, workspace_id=workspace_id,
                                                chunk_index=c.index, text=c.text, page=c.page, section=c.section,
                                                char_count=len(c.text)) for c in chunks])
                    await sess.execute(sa.update(Document).where(Document.id == doc.id).values(
                        status="ready", error="; ".join(parsed.warnings) or None, title=title,
                        page_count=parsed.page_count, chunk_count=len(chunks),
                        embedding_model=self.kb.embedder.model_id, embedding_dim=index.dim,
                        chunk_size=s.chunk_size, chunk_overlap=s.chunk_overlap,
                        indexed_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc)))
                    await sess.commit()
            except asyncio.CancelledError:
                raise  # server shutdown: stays "processing" and is re-queued by recover()
            except Exception as exc:
                msg = str(exc) if isinstance(exc, ParseError) else f"Indexing failed ({type(exc).__name__}: {exc})"
                log.warning("ingestion of %s failed: %s", document_id, msg)
                try:
                    await self._delete_vectors(workspace_id, doc)
                except Exception:
                    log.exception("could not remove partial vectors for %s", document_id)
                await self._fail(workspace_id, doc, msg)
                return
            await self.bus.emit(workspace_id, EventType.DOCUMENT_INDEXING_COMPLETED, {
                "document_id": doc.id, "filename": doc.filename, "status": "ready", "chunk_count": len(chunks),
                "page_count": parsed.page_count, "embedding_model": self.kb.embedder.model_id,
                "duration_s": round(time.monotonic() - started, 2), "warnings": parsed.warnings})

    async def _fail(self, workspace_id: str, doc: Document, msg: str) -> None:
        try:
            async with self.db.sessions() as s:
                await s.execute(sa.delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
                await s.commit()
            await self._set(doc.id, status="failed", error=msg[:2000], chunk_count=0)
        except Exception:
            log.exception("could not mark %s as failed", doc.id)
        await self.bus.emit(workspace_id, EventType.DOCUMENT_INDEXING_FAILED, {
            "document_id": doc.id, "filename": doc.filename, "status": "failed", "error": msg[:500]})

    async def _delete_vectors(self, workspace_id: str, doc: Document) -> None:
        index, _ = self.kb.require()
        await asyncio.to_thread(index.delete_document, workspace_id, doc.id)
        old = self.kb.collection_for(doc.embedding_model, doc.embedding_dim)
        if old and old != index.collection:
            await asyncio.to_thread(index.delete_document, workspace_id, doc.id, old)

    # ---------- delete / reindex ----------

    async def delete(self, workspace_id: str, document_id: str) -> None:
        doc = await self.get(workspace_id, document_id)
        if (task := self._tasks.get(document_id)) and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        # Vectors first: if Qdrant is down, keep the metadata so nothing is orphaned.
        if self.kb.status == "ready":
            await self._delete_vectors(workspace_id, doc)
        elif doc.chunk_count or doc.status in ("ready", "processing"):
            raise KnowledgeUnavailable("Cannot delete the document's vectors while the Knowledge Library is unavailable.")
        async with self.db.sessions() as s:
            # Missions keep the citation metadata (file name, page) but not the deleted content.
            await s.execute(sa.update(MissionEvidence).where(MissionEvidence.document_id == document_id).values(text=None))
            await s.execute(sa.delete(Document).where(Document.id == document_id, Document.workspace_id == workspace_id))
            await s.commit()
        await asyncio.to_thread(self.storage.delete, doc.storage_key)
        await self.bus.emit(workspace_id, EventType.DOCUMENT_DELETED, {"document_id": document_id, "filename": doc.filename})

    async def reindex(self, workspace_id: str, document_id: str) -> Document:
        doc = await self.get(workspace_id, document_id)
        if doc.status in ("pending", "processing"):
            return doc
        self.kb.require()
        await self._set(document_id, status="pending", error=None)
        self.schedule(workspace_id, document_id)
        return await self.get(workspace_id, document_id)

    # ---------- lifecycle ----------

    async def recover(self) -> int:
        """Re-queue documents left pending/processing by a previous server process."""
        async with self.db.sessions() as s:
            rows = (await s.execute(sa.select(Document.id, Document.workspace_id).where(
                Document.status.in_(("pending", "processing"))))).all()
        for doc_id, ws in rows:
            self.schedule(ws, doc_id)
        return len(rows)

    async def wait_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks.values()), return_exceptions=True)

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
