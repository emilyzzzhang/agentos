"""Dense semantic retrieval over indexed document chunks.

This module holds retrieval policy (argument checks, workspace and document scoping, score
floor, result shape) and no Qdrant code. BM25/hybrid search or a reranker can be added here
as extra steps around `VectorIndex.search`.
"""
from __future__ import annotations

import asyncio

from pydantic import BaseModel

from .vector_store import VectorIndex


class RetrievedChunk(BaseModel):
    document_id: str
    title: str
    filename: str
    chunk_id: str
    chunk_index: int
    text: str
    page: int | None = None
    section: str | None = None
    # Cosine similarity between query and chunk embeddings (higher = closer). It ranks results
    # for one query; it is not a probability and not a confidence value.
    score: float | None = None

    def reference(self) -> str:
        loc = f"p. {self.page}" if self.page else (f"§ {self.section}" if self.section else None)
        return f"{self.filename}{', ' + loc if loc else ''}"


class RetrievalError(RuntimeError):
    pass


class RetrievalService:
    def __init__(self, index: VectorIndex, *, default_top_k: int = 5, max_top_k: int = 10, min_score: float = 0.0) -> None:
        self.index = index
        self.default_top_k = default_top_k
        self.max_top_k = max_top_k
        self.min_score = min_score

    async def search(self, query: str, *, workspace_id: str, document_ids: list[str] | None = None,
                     top_k: int | None = None) -> list[RetrievedChunk]:
        query = (query or "").strip()
        if not query:
            raise RetrievalError("query must not be empty")
        if not workspace_id:
            raise RetrievalError("workspace_id is required")
        if document_ids is not None and not document_ids:
            return []  # an explicit empty scope means "no documents"
        k = max(1, min(top_k or self.default_top_k, self.max_top_k))
        try:
            hits = await asyncio.to_thread(self.index.search, query, workspace_id=workspace_id,
                                           document_ids=document_ids, k=k)
        except Exception as exc:
            raise RetrievalError(f"vector search failed ({type(exc).__name__}: {exc})") from exc
        out: list[RetrievedChunk] = []
        for h in hits:
            m = h.metadata
            # Defense in depth: the Qdrant filter already scopes the query.
            if m.get("workspace_id") != workspace_id or (document_ids is not None and m.get("document_id") not in document_ids):
                continue
            if h.score < self.min_score:
                continue
            out.append(RetrievedChunk(
                document_id=m["document_id"], title=m.get("title") or m.get("filename") or m["document_id"],
                filename=m.get("filename") or "", chunk_id=m["chunk_id"], chunk_index=int(m.get("chunk_index", 0)),
                text=h.text, page=m.get("page"), section=m.get("section"), score=round(h.score, 4)))
        return out
