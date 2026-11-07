"""Integration tests against the real services from docker-compose.yml (skipped if they are not running).

* PostgreSQL: Alembic migrations on a fresh `agentos_test` database (never the app database), plus a
  persistence round trip with JSONB.
* Qdrant + the real Sentence Transformers model: semantic (not lexical) retrieval of the Aurora fact,
  in a throwaway collection prefix.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
import sqlalchemy as sa

from config import get_settings

BACKEND = Path(__file__).resolve().parents[1]


def _pg_urls() -> tuple[str, str]:
    base = sa.make_url(os.getenv("AGENTOS_TEST_DATABASE_URL") or get_settings().database_url)
    test = base.set(database="agentos_test")
    admin = base.set(database=base.database if os.getenv("AGENTOS_TEST_DATABASE_URL") is None else "postgres")
    return admin.render_as_string(hide_password=False), test.render_as_string(hide_password=False)


def _recreate_test_db() -> str:
    admin_url, test_url = _pg_urls()
    if not admin_url.startswith("postgresql"):
        pytest.skip("not a PostgreSQL URL")
    import psycopg
    plain = admin_url.replace("postgresql+psycopg://", "postgresql://")
    try:
        conn = psycopg.connect(plain, autocommit=True, connect_timeout=3)
    except Exception as exc:
        pytest.skip(f"PostgreSQL not reachable ({type(exc).__name__}); run `docker compose up -d`")
    with conn:
        conn.execute("DROP DATABASE IF EXISTS agentos_test WITH (FORCE)")
        conn.execute("CREATE DATABASE agentos_test")
    return test_url


def _alembic(url: str):
    from alembic.config import Config
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "db" / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    cfg.attributes["configure_logger"] = False
    return cfg


def test_alembic_migrations_on_postgres():
    from alembic import command
    url = _recreate_test_db()
    cfg = _alembic(url)
    command.upgrade(cfg, "head")
    eng = sa.create_engine(url)
    with eng.connect() as c:
        tables = set(sa.inspect(c).get_table_names())
        assert {"workspaces", "missions", "mission_events", "documents", "document_chunks", "mission_evidence",
                "alembic_version"} <= tables
        assert c.execute(sa.text("select id from workspaces")).scalars().all() == ["default"]
        assert c.execute(sa.text("select version_num from alembic_version")).scalar() == "0001"
        cols = {col["name"]: col for col in sa.inspect(c).get_columns("mission_events")}
        assert cols["payload"]["type"].__class__.__name__ == "JSONB"
    command.downgrade(cfg, "base")
    with eng.connect() as c:
        assert set(sa.inspect(c).get_table_names()) == {"alembic_version"}
    command.upgrade(cfg, "head")  # migrations are repeatable
    eng.dispose()


def test_persistence_round_trip_on_postgres():
    from alembic import command

    from db.missions import MissionStore
    from db.models import Document
    from db.session import Database
    from events import EventType, ExecutionEvent

    url = _recreate_test_db()
    command.upgrade(_alembic(url), "head")

    async def go():
        db = Database(url)
        await db.check()
        store = MissionStore(db)
        await store.create(workspace_id="default", run_id="run_pg", question="q?", mode="live", model="m",
                           document_scope=None)
        for i, t in enumerate([EventType.RUN_STARTED, EventType.RAG_RETRIEVAL_COMPLETED, EventType.RUN_COMPLETED], 1):
            await store.add_event(ExecutionEvent(run_id="run_pg", seq=i, type=t, payload={"n": i, "nested": {"a": [1]}}))
        await store.finish(run_id="run_pg", status="completed", error=None, workspace_id="default",
                           result={"report_markdown": "# R", "report": {"title": "R"}, "cited_sources": ["D1"],
                                   "sources": {"D1": {}}, "revision_count": 0},
                           evidence={"D1": {"kind": "document", "title": "a.md", "document_id": None,
                                            "chunk_id": "c", "page": 2, "text": "passage", "score": 0.7}})
        await db.close()
        db2 = Database(url)  # a new engine, as after a restart
        store2 = MissionStore(db2)
        m = await store2.get("default", "run_pg")
        assert m.status == "completed" and m.document_scope is None and m.report_markdown == "# R" and m.event_count == 3
        evs = await store2.events("default", "run_pg", after=1)
        assert [e.seq for e in evs] == [2, 3] and evs[0].payload["nested"] == {"a": [1]}
        ev = await store2.evidence("default", "run_pg")
        assert ev[0].cited and ev[0].citation_number == 1 and ev[0].page == 2
        assert await store2.get("other", "run_pg") is None  # workspace filter
        async with db2.sessions() as s:  # unique (workspace, sha256)
            for i in range(2):
                s.add(Document(id=f"doc_{i}", workspace_id="default", filename="a", title="a", file_type="text",
                               content_type="text/plain", size_bytes=1, sha256="x" * 64, storage_key=f"k{i}",
                               status="pending"))
            with pytest.raises(sa.exc.IntegrityError):
                await s.commit()
        await db2.close()

    asyncio.run(go())


def test_real_embeddings_and_qdrant_semantic_retrieval():
    from qdrant_client import QdrantClient

    from rag.embeddings import SentenceTransformerEmbeddings
    from rag.retrieval import RetrievalService
    from rag.vector_store import IndexedChunk, VectorIndex

    s = get_settings()
    try:
        QdrantClient(url=s.qdrant_url, timeout=3).get_collections()
    except Exception as exc:
        pytest.skip(f"Qdrant not reachable ({type(exc).__name__}); run `docker compose up -d`")
    from huggingface_hub import try_to_load_from_cache
    if not isinstance(try_to_load_from_cache(s.embedding_model, "config.json"), str):
        pytest.skip(f"embedding model {s.embedding_model} is not downloaded yet")

    emb = SentenceTransformerEmbeddings(s.embedding_model)
    index = VectorIndex.connect(url=s.qdrant_url, api_key=s.qdrant_api_key, embedder=emb, prefix="agentos_itest")
    try:
        texts = ["Project Aurora supports a maximum batch size of 137 records.",
                 "The cafeteria serves lunch from noon until two o'clock.",
                 "Quarterly revenue grew because of strong hardware sales.",
                 "Project Zephyr stores its logs for thirty days."]
        index.add([IndexedChunk(chunk_id=f"doc_it-c{i:04d}", text=t, metadata={
            "workspace_id": "itest", "document_id": "doc_it", "chunk_id": f"doc_it-c{i:04d}", "chunk_index": i,
            "filename": "aurora.txt", "title": "Aurora", "page": None, "section": None}) for i, t in enumerate(texts)])
        service = RetrievalService(index, default_top_k=3, min_score=0.2)
        # Paraphrase: shares few words with the stored sentence, so this exercises semantic similarity.
        res = asyncio.run(service.search("How many items can Aurora process at once?", workspace_id="itest"))
        assert res and res[0].chunk_id == "doc_it-c0000", [(r.text, r.score) for r in res]
        assert index.dim == 384 and index.collection.endswith("__384")
        assert asyncio.run(service.search("Aurora batch", workspace_id="someone-else")) == []
        index.delete_document("itest", "doc_it")
        assert index.count("itest") == 0
    finally:
        index.client.delete_collection(index.collection)
        index.close()
