"""Ingestion, indexing, retrieval, scoping, and deletion with SQLite + in-memory Qdrant."""
import pytest
import sqlalchemy as sa
from qdrant_client import QdrantClient, models

from db.models import Document, DocumentChunk, Mission, MissionEvidence
from db.session import Database
from events import LibraryEventBus
from rag.documents import DocumentService, DuplicateDocument
from rag.parsing import UnsupportedFile
from rag.tools import build_document_search_tool
from rag.vector_store import VectorIndex, VectorIndexError, collection_name
from storage.files import LocalFileStorage, StorageError

from .fakes import HashEmbeddings, make_kb
from .pdfgen import make_pdf

AURORA = b"# Aurora\n\n## Limits\n\nProject Aurora supports a maximum batch size of 137 records.\n\n## Other\n\nUnrelated notes about lunch menus."


@pytest.fixture
async def env(settings):
    db = Database(settings.database_url)
    await db.create_all()
    for ws in ("default", "other"):
        await db.ensure_workspace(ws)
    kb = make_kb(settings)
    await kb.start()
    assert kb.status == "ready", kb.error
    bus = LibraryEventBus()
    svc = DocumentService(settings, db, LocalFileStorage(settings.upload_dir), kb, bus)
    yield svc
    await svc.shutdown()
    await db.close()


async def ingest(svc, ws, name, data):
    doc = await svc.upload(ws, name, data)
    await svc.wait_idle()
    return await svc.get(ws, doc.id)


async def test_ingest_index_and_retrieve(env):
    svc = env
    doc = await ingest(svc, "default", "aurora.md", AURORA)
    assert doc.status == "ready", doc.error
    assert doc.chunk_count == 2 and doc.embedding_model == "test/hash-embeddings" and doc.embedding_dim == 256
    assert doc.title == "Aurora" and doc.file_type == "markdown" and doc.size_bytes == len(AURORA)
    async with svc.db.sessions() as s:
        chunks = list((await s.execute(sa.select(DocumentChunk).order_by(DocumentChunk.chunk_index))).scalars())
    assert [c.section for c in chunks] == ["Aurora > Limits", "Aurora > Other"]
    assert svc.kb.index.count("default", doc.id) == 2

    res = await svc.kb.retrieval.search("maximum batch size Aurora records", workspace_id="default")
    assert res[0].document_id == doc.id and "137 records" in res[0].text
    assert res[0].section == "Aurora > Limits" and res[0].filename == "aurora.md" and res[0].chunk_id == chunks[0].id
    assert 0 < res[0].score <= 1.0001

    types = [e.type.value for e in svc.bus.since("default", 0)]
    assert types == ["document.uploaded", "document.indexing_started", "document.indexing_completed"]
    assert all("text" not in e.payload for e in svc.bus.since("default", 0))  # metadata only


async def test_pdf_page_numbers_survive_to_retrieval(env):
    pdf = make_pdf(["Cover page.", "Aurora retries failed uploads three times.", "Batch size limit is 137 records."])
    doc = await ingest(env, "default", "aurora.pdf", pdf)
    assert doc.status == "ready" and doc.page_count == 3
    res = await env.kb.retrieval.search("batch size limit records", workspace_id="default", top_k=1)
    assert res[0].page == 3


async def test_document_filter_and_workspace_isolation(env):
    a = await ingest(env, "default", "aurora.md", AURORA)
    b = await ingest(env, "default", "zephyr.txt", b"Project Zephyr supports a maximum batch size of 512 records.")
    c = await ingest(env, "other", "aurora-copy.md", AURORA)  # same bytes, other workspace: allowed
    r = env.kb.retrieval
    only_b = await r.search("maximum batch size records", workspace_id="default", document_ids=[b.id])
    assert only_b and {x.document_id for x in only_b} == {b.id}
    default = await r.search("maximum batch size records", workspace_id="default")
    assert {x.document_id for x in default} == {a.id, b.id}
    other = await r.search("maximum batch size records", workspace_id="other")
    assert {x.document_id for x in other} == {c.id}
    # another workspace's document id does not leak through the document filter
    assert await r.search("batch size", workspace_id="default", document_ids=[c.id]) == []
    assert await r.search("batch size", workspace_id="default", document_ids=[]) == []
    assert [d.id for d in await env.list("other")] == [c.id]
    with pytest.raises(LookupError):
        await env.get("default", c.id)


async def test_langchain_tool_is_bound_to_scope(env):
    a = await ingest(env, "default", "aurora.md", AURORA)
    await ingest(env, "default", "zephyr.txt", b"Project Zephyr supports a maximum batch size of 512 records.")
    tool = build_document_search_tool(env.kb.retrieval, workspace_id="default", document_ids=[a.id])
    assert tool.name == "search_documents" and set(tool.args) == {"query", "top_k"}  # no scope arguments
    msg = await tool.ainvoke({"type": "tool_call", "id": "c1", "name": tool.name,
                              "args": {"query": "maximum batch size records", "top_k": 3}})
    assert {r["document_id"] for r in msg.artifact} == {a.id}
    assert "aurora.md" in msg.content and "<<<PASSAGE" in msg.content and "512" not in msg.content


async def test_delete_removes_vectors_rows_file_and_evidence_text(env):
    doc = await ingest(env, "default", "aurora.md", AURORA)
    async with env.db.sessions() as s:
        s.add(Mission(id="run_1", workspace_id="default", question="q", mode="live", status="completed"))
        s.add(MissionEvidence(mission_id="run_1", evidence_id="D1", workspace_id="default", kind="document",
                              title="Aurora", document_id=doc.id, chunk_id=f"{doc.id}-c0000", text="secret passage"))
        await s.commit()
    await env.delete("default", doc.id)
    assert env.kb.index.count("default", doc.id) == 0
    async with env.db.sessions() as s:
        assert await s.get(Document, doc.id) is None
        assert (await s.execute(sa.select(sa.func.count()).select_from(DocumentChunk))).scalar() == 0
        ev = await s.get(MissionEvidence, ("run_1", "D1"))
    assert ev.text is None and ev.document_id is None and ev.title == "Aurora"  # citation kept, content gone
    with pytest.raises(StorageError):
        env.storage.get(doc.storage_key)
    assert env.bus.since("default", 0)[-1].type.value == "document.deleted"
    assert await env.kb.retrieval.search("batch size", workspace_id="default") == []


async def test_duplicates_and_upload_validation(env):
    first = await ingest(env, "default", "aurora.md", AURORA)
    with pytest.raises(DuplicateDocument) as exc:
        await env.upload("default", "renamed.md", AURORA)
    assert exc.value.existing.id == first.id
    with pytest.raises(UnsupportedFile):
        await env.upload("default", "x.docx", b"PK..")


async def test_failed_ingestion_sets_failed_status(env):
    doc = await ingest(env, "default", "scan.pdf", make_pdf(["", ""]))
    assert doc.status == "failed" and "OCR" in doc.error and doc.chunk_count == 0
    bad = await ingest(env, "default", "broken.pdf", b"%PDF-1.7\ngarbage")
    assert bad.status == "failed" and "malformed" in bad.error
    assert env.bus.since("default", 0)[-1].type.value == "document.indexing_failed"
    assert env.kb.index.count("default") == 0


async def test_vector_write_failure_marks_failed_not_stuck(env, monkeypatch):
    def boom(chunks):
        raise RuntimeError("qdrant down")
    monkeypatch.setattr(env.kb.index, "add", boom)
    doc = await ingest(env, "default", "aurora.md", AURORA)
    assert doc.status == "failed" and "qdrant down" in doc.error


async def test_recover_requeues_interrupted_documents(env):
    doc = await env.upload("default", "aurora.md", AURORA)
    await env.shutdown()  # simulate a stop before indexing finished
    async with env.db.sessions() as s:
        await s.execute(sa.update(Document).values(status="processing"))
        await s.commit()
    assert await env.recover() == 1
    await env.wait_idle()
    assert (await env.get("default", doc.id)).status == "ready"


async def test_embedding_models_are_never_mixed(settings):
    client = QdrantClient(location=":memory:")
    a = VectorIndex(client, HashEmbeddings(dim=64, model_id="m/a"), "p")
    b = VectorIndex(client, HashEmbeddings(dim=32, model_id="m/b"), "p")
    assert a.collection == collection_name("p", "m/a", 64) != b.collection
    # Same model name but a different dimension against an existing collection: refused.
    client.create_collection("p__m-c__16", vectors_config=models.VectorParams(size=8, distance=models.Distance.COSINE))
    with pytest.raises((VectorIndexError, ValueError)):
        VectorIndex(client, HashEmbeddings(dim=16, model_id="m/c"), "p")


async def test_model_change_marks_documents_for_reindex(env, settings):
    doc = await ingest(env, "default", "aurora.md", AURORA)
    new_kb = make_kb(settings, embedder=HashEmbeddings(dim=128, model_id="test/other-model"))
    await new_kb.start()
    svc2 = DocumentService(settings, env.db, env.storage, new_kb, LibraryEventBus())
    assert await svc2.ready_documents("default") == []  # old vectors are not searchable with the new model
    from rag.documents import document_to_dict
    assert document_to_dict(await svc2.get("default", doc.id), new_kb)["needs_reindex"] is True
    await svc2.reindex("default", doc.id)
    await svc2.wait_idle()
    re_doc = await svc2.get("default", doc.id)
    assert re_doc.embedding_model == "test/other-model" and re_doc.embedding_dim == 128
    assert [d.id for d in await svc2.ready_documents("default")] == [doc.id]
