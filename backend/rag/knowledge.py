"""Owns the embedding model, the vector index, and the retrieval service for the app's lifetime.

Startup is asynchronous: loading the embedding model (and downloading it the first time) and
connecting to Qdrant happen in a worker thread, so the API starts serving immediately. Until
then `status` is "starting"; if setup fails it is "unavailable" and web-only missions still work.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Literal

from config import Settings

from .embeddings import Embedder, SentenceTransformerEmbeddings
from .retrieval import RetrievalService
from .vector_store import VectorIndex, collection_name

log = logging.getLogger(__name__)
IndexFactory = Callable[[Embedder], VectorIndex]


class KnowledgeUnavailable(RuntimeError):
    pass


class KnowledgeBase:
    def __init__(self, settings: Settings, *, embedder: Embedder | None = None,
                 index_factory: IndexFactory | None = None) -> None:
        self.settings = settings
        self.embedder: Embedder = embedder or SentenceTransformerEmbeddings(
            settings.embedding_model, device=settings.embedding_device)
        self._index_factory = index_factory
        self.status: Literal["starting", "ready", "unavailable"] = "starting"
        self.error: str | None = None
        self.index: VectorIndex | None = None
        self.retrieval: RetrievalService | None = None
        self._ready = asyncio.Event()

    def _build_index(self) -> VectorIndex:
        if self._index_factory:
            return self._index_factory(self.embedder)
        s = self.settings
        return VectorIndex.connect(url=s.qdrant_url, api_key=s.qdrant_api_key, embedder=self.embedder,
                                   prefix=s.qdrant_collection_prefix)

    async def start(self) -> None:
        try:
            self.index = await asyncio.to_thread(self._build_index)
            self.retrieval = RetrievalService(self.index, default_top_k=self.settings.rag_top_k,
                                              min_score=self.settings.rag_min_score)
            self.status = "ready"
            log.info("knowledge base ready: %s (%d dims) in %s", self.embedder.model_id, self.index.dim,
                     self.index.collection)
        except Exception as exc:
            self.status, self.error = "unavailable", f"{type(exc).__name__}: {exc}"
            log.error("knowledge base unavailable: %s", self.error)
        finally:
            self._ready.set()

    async def wait_ready(self, timeout: float | None = None) -> bool:
        try:
            await asyncio.wait_for(self._ready.wait(), timeout)
        except asyncio.TimeoutError:
            return False
        return self.status == "ready"

    def require(self) -> tuple[VectorIndex, RetrievalService]:
        if self.status != "ready" or not self.index or not self.retrieval:
            raise KnowledgeUnavailable(
                "The Knowledge Library is starting up." if self.status == "starting"
                else f"The Knowledge Library is unavailable: {self.error}")
        return self.index, self.retrieval

    @property
    def dimension(self) -> int | None:
        return self.index.dim if self.index else None

    def collection_for(self, model_id: str | None, dim: int | None) -> str | None:
        if not model_id or not dim:
            return None
        return collection_name(self.settings.qdrant_collection_prefix, model_id, dim)

    def is_current(self, model_id: str | None, dim: int | None) -> bool:
        return bool(self.index) and model_id == self.embedder.model_id and dim == self.index.dim

    def info(self) -> dict:
        return {"status": self.status, "error": self.error, "embedding_model": self.embedder.model_id,
                "embedding_dim": self.dimension, "collection": self.index.collection if self.index else None,
                "chunk_size": self.settings.chunk_size, "chunk_overlap": self.settings.chunk_overlap,
                "max_upload_mb": self.settings.max_upload_mb, "top_k": self.settings.rag_top_k,
                "min_score": self.settings.rag_min_score}

    def close(self) -> None:
        if self.index:
            self.index.close()
