"""Qdrant-specific code: client connection, collection setup, writes, deletes, and dense search.

Nothing outside this module imports qdrant_client. Retrieval logic (rag/retrieval.py) talks to
`VectorIndex` only, so a different vector database, or hybrid search, can be added here.

Collections are named after the embedding model and its dimension, for example
`agentos_chunks__sentence-transformers-all-minilm-l6-v2__384`. Switching models therefore
creates a new, empty collection instead of mixing incompatible vectors; documents indexed with
the old model must be reindexed (POST /documents/{id}/reindex).
"""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any

from langchain_core.documents import Document as LCDocument
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models

from .embeddings import Embedder

log = logging.getLogger(__name__)
_POINT_NS = uuid.UUID("6f1c2b8e-2d4a-4a57-9a43-3f0c9d1a7e21")
META = "metadata"  # langchain-qdrant payload key for metadata


def collection_name(prefix: str, model_id: str, dim: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", model_id.lower()).strip("-")
    return f"{prefix}__{slug}__{dim}"


def point_id(chunk_id: str) -> str:
    """Qdrant needs UUID or integer IDs; derive a stable UUID from the chunk ID."""
    return str(uuid.uuid5(_POINT_NS, chunk_id))


@dataclass
class IndexedChunk:
    chunk_id: str
    text: str
    metadata: dict[str, Any]


@dataclass
class VectorHit:
    text: str
    metadata: dict[str, Any]
    score: float


class VectorIndexError(RuntimeError):
    pass


class VectorIndex:
    """All methods are blocking; callers run them in worker threads."""

    def __init__(self, client: QdrantClient, embedder: Embedder, prefix: str) -> None:
        self.client = client
        self.embedder = embedder
        self.dim = embedder.dimension
        self.collection = collection_name(prefix, embedder.model_id, self.dim)
        self._ensure_collection()
        # validate_collection_config raises if the collection's vector size or distance does not
        # match this embedder: a second guard against mixing embeddings.
        self.store = QdrantVectorStore(client=client, collection_name=self.collection, embedding=embedder,
                                       distance=models.Distance.COSINE)

    @classmethod
    def connect(cls, *, url: str, api_key: str | None, embedder: Embedder, prefix: str) -> VectorIndex:
        client = QdrantClient(url=url, api_key=api_key, timeout=30)
        try:
            client.get_collections()
        except Exception as exc:
            raise VectorIndexError(f"Cannot reach Qdrant at {url} ({type(exc).__name__}). "
                                   "Start it with `docker compose up -d`.") from exc
        return cls(client, embedder, prefix)

    def _ensure_collection(self) -> None:
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                self.collection, vectors_config=models.VectorParams(size=self.dim, distance=models.Distance.COSINE))
            log.info("created Qdrant collection %s", self.collection)
        else:
            info = self.client.get_collection(self.collection)
            params = info.config.params.vectors
            size = params.size if isinstance(params, models.VectorParams) else None
            if size != self.dim:
                raise VectorIndexError(f"collection {self.collection} has vector size {size}, expected {self.dim}")
        for key in ("workspace_id", "document_id"):  # filtered on every query
            try:
                self.client.create_payload_index(self.collection, f"{META}.{key}",
                                                 field_schema=models.PayloadSchemaType.KEYWORD)
            except Exception as exc:  # already exists, or local mode (no payload indexes)
                log.debug("payload index %s: %s", key, exc)

    @staticmethod
    def _filter(workspace_id: str, document_ids: list[str] | None = None) -> models.Filter:
        must: list[Any] = [models.FieldCondition(key=f"{META}.workspace_id", match=models.MatchValue(value=workspace_id))]
        if document_ids is not None:
            must.append(models.FieldCondition(key=f"{META}.document_id", match=models.MatchAny(any=list(document_ids))))
        return models.Filter(must=must)

    def add(self, chunks: list[IndexedChunk]) -> None:
        if not chunks:
            return
        self.store.add_documents(
            [LCDocument(page_content=c.text, metadata=c.metadata) for c in chunks],
            ids=[point_id(c.chunk_id) for c in chunks], batch_size=64)

    def delete_document(self, workspace_id: str, document_id: str, collection: str | None = None) -> None:
        target = collection or self.collection
        if target != self.collection and not self.client.collection_exists(target):
            return
        self.client.delete(target, points_selector=models.FilterSelector(
            filter=self._filter(workspace_id, [document_id])), wait=True)

    def count(self, workspace_id: str, document_id: str | None = None) -> int:
        return self.client.count(self.collection, count_filter=self._filter(
            workspace_id, [document_id] if document_id else None), exact=True).count

    def search(self, query: str, *, workspace_id: str, document_ids: list[str] | None, k: int) -> list[VectorHit]:
        results = self.store.similarity_search_with_score(query, k=k, filter=self._filter(workspace_id, document_ids))
        return [VectorHit(text=d.page_content, metadata=d.metadata, score=float(s)) for d, s in results]

    def close(self) -> None:
        try:
            self.client.close()
        except Exception:
            pass
