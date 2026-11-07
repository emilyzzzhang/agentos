"""Embedding models. Anything that implements LangChain's `Embeddings` plus `model_id` and
`dimension` works, so a hosted provider can replace the local model later.

Ingestion and query retrieval always use the same instance. The model ID and dimension name
the Qdrant collection and are stored on every document, so vectors from different models are
never mixed (see vector_store.collection_name).
"""
from __future__ import annotations

import threading
from typing import Protocol

from langchain_core.embeddings import Embeddings


class Embedder(Protocol):
    model_id: str

    @property
    def dimension(self) -> int: ...
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbeddings(Embeddings):
    """Local Sentence Transformers model (default: all-MiniLM-L6-v2, 384 dimensions).

    Loaded lazily and once; calls are CPU-bound, so callers run them in a worker thread.
    Vectors are L2-normalized, so cosine similarity equals the dot product.
    """

    def __init__(self, model_id: str, device: str = "cpu", batch_size: int = 32) -> None:
        self.model_id = model_id
        self.device = device
        self.batch_size = batch_size
        self._model = None
        self._lock = threading.Lock()

    def load(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self.model_id, device=self.device)
        return self._model

    @property
    def dimension(self) -> int:
        m = self.load()
        dim = m.get_sentence_embedding_dimension()
        if not dim:
            raise RuntimeError(f"model {self.model_id} does not report an embedding dimension")
        return int(dim)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vecs = self.load().encode(texts, batch_size=self.batch_size, normalize_embeddings=True,
                                  convert_to_numpy=True, show_progress_bar=False)
        return vecs.tolist()

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]
