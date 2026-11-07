"""Centralized configuration. All model / provider choices live here."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
# The repo-root .env holds the Docker Compose database settings; backend/.env wins on conflicts.
load_dotenv(BACKEND_DIR.parent / ".env")

Effort = Literal["low", "medium", "high", "xhigh", "max"]


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


class Settings(BaseModel):
    anthropic_api_key: str | None = None
    model: str = "claude-sonnet-5-5"
    search_model: str = "claude-sonnet-5-5"
    effort_manager: Effort = "low"
    effort_researcher: Effort = "low"
    effort_reviewer: Effort = "medium"
    llm_max_tokens: int = 12000
    llm_timeout_s: float = 180.0

    search_provider: Literal["anthropic", "tavily"] = "anthropic"
    search_tool_version: str = "web_search_20260209"
    search_max_uses: int = 2
    tavily_api_key: str | None = None

    max_revisions: int = 2
    max_queries_initial: int = 4
    max_queries_followup: int = 3

    refusal_fallback: bool = True
    enable_demo: bool = True

    data_dir: Path = BACKEND_DIR / "data"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # --- persistence ---
    database_url: str = "postgresql+psycopg://agentos:agentos@127.0.0.1:5433/agentos"
    # One local workspace until authentication exists. Every query is filtered by it.
    workspace_id: str = "default"

    # --- knowledge library (RAG) ---
    qdrant_url: str = "http://127.0.0.1:6333"
    qdrant_api_key: str | None = None
    qdrant_collection_prefix: str = "agentos_chunks"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_device: str = "cpu"
    chunk_size: int = 1000          # characters
    chunk_overlap: int = 150        # characters
    max_upload_mb: int = 20
    max_pdf_pages: int = 1000
    ingest_concurrency: int = 1     # documents processed at the same time
    max_pending_documents: int = 50
    rag_top_k: int = 5
    rag_min_score: float = 0.2      # cosine similarity floor; not a confidence value
    max_doc_queries: int = 4

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def has_api_key(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    data_dir = Path(os.getenv("AGENTOS_DATA_DIR", str(BACKEND_DIR / "data")))
    if not data_dir.is_absolute():
        data_dir = (BACKEND_DIR / data_dir).resolve()
    origins = os.getenv("AGENTOS_CORS_ORIGINS")
    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        model=os.getenv("AGENTOS_MODEL") or "claude-sonnet-5-5",
        search_model=os.getenv("AGENTOS_SEARCH_MODEL") or os.getenv("AGENTOS_MODEL") or "claude-sonnet-5-5",
        effort_manager=os.getenv("AGENTOS_EFFORT_MANAGER") or "low",
        effort_researcher=os.getenv("AGENTOS_EFFORT_RESEARCHER") or "low",
        effort_reviewer=os.getenv("AGENTOS_EFFORT_REVIEWER") or "medium",
        search_provider=os.getenv("AGENTOS_SEARCH_PROVIDER") or "anthropic",
        search_tool_version=os.getenv("AGENTOS_SEARCH_TOOL_VERSION") or "web_search_20260209",
        tavily_api_key=os.getenv("TAVILY_API_KEY") or None,
        max_revisions=_int("AGENTOS_MAX_REVISIONS", 2),
        max_queries_initial=_int("AGENTOS_MAX_QUERIES_INITIAL", 4),
        max_queries_followup=_int("AGENTOS_MAX_QUERIES_FOLLOWUP", 3),
        refusal_fallback=_bool("AGENTOS_REFUSAL_FALLBACK", True),
        enable_demo=_bool("AGENTOS_ENABLE_DEMO", True),
        data_dir=data_dir,
        cors_origins=[o.strip() for o in origins.split(",")] if origins else Settings().cors_origins,
        database_url=_database_url(),
        workspace_id=os.getenv("AGENTOS_WORKSPACE_ID") or "default",
        qdrant_url=os.getenv("AGENTOS_QDRANT_URL") or f"http://127.0.0.1:{os.getenv('AGENTOS_QDRANT_PORT') or 6333}",
        qdrant_api_key=os.getenv("AGENTOS_QDRANT_API_KEY") or None,
        qdrant_collection_prefix=os.getenv("AGENTOS_QDRANT_COLLECTION_PREFIX") or "agentos_chunks",
        embedding_model=os.getenv("AGENTOS_EMBEDDING_MODEL") or "sentence-transformers/all-MiniLM-L6-v2",
        embedding_device=os.getenv("AGENTOS_EMBEDDING_DEVICE") or "cpu",
        chunk_size=_int("AGENTOS_CHUNK_SIZE", 1000),
        chunk_overlap=_int("AGENTOS_CHUNK_OVERLAP", 150),
        max_upload_mb=_int("AGENTOS_MAX_UPLOAD_MB", 20),
        max_pdf_pages=_int("AGENTOS_MAX_PDF_PAGES", 1000),
        ingest_concurrency=_int("AGENTOS_INGEST_CONCURRENCY", 1),
        max_pending_documents=_int("AGENTOS_MAX_PENDING_DOCUMENTS", 50),
        rag_top_k=_int("AGENTOS_RAG_TOP_K", 5),
        rag_min_score=float(os.getenv("AGENTOS_RAG_MIN_SCORE") or 0.2),
        max_doc_queries=_int("AGENTOS_MAX_DOC_QUERIES", 4),
    )


def _database_url() -> str:
    """AGENTOS_DATABASE_URL wins (managed Postgres later); otherwise build it from the Compose settings."""
    if url := os.getenv("AGENTOS_DATABASE_URL"):
        return url
    from urllib.parse import quote
    user = os.getenv("AGENTOS_PG_USER") or "agentos"
    password = os.getenv("AGENTOS_PG_PASSWORD") or "agentos"
    db = os.getenv("AGENTOS_PG_DB") or "agentos"
    port = os.getenv("AGENTOS_PG_PORT") or "5433"
    return f"postgresql+psycopg://{quote(user)}:{quote(password)}@127.0.0.1:{port}/{db}"
