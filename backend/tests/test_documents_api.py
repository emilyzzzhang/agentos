"""Knowledge Library HTTP API, mission document scope, evidence, persistence across restarts."""
import asyncio
import json

import httpx
import pytest

from api.deps import workspace
from main import create_app

from .fakes import FakeLLM, FakeSearch, make_kb, started
from .pdfgen import make_pdf
from .test_api import parse_sse, wait_done

AURORA_MD = b"# Aurora\n\n## Limits\n\nProject Aurora supports a maximum batch size of 137 records.\n"
AURORA_QUERIES = (("What is the maximum batch size in Project Aurora?", "Aurora batch records"), ("q2",))


def make(settings, llm_factory=lambda: FakeLLM()):
    return create_app(settings, deps=lambda s, mode: (llm_factory(), FakeSearch()), kb=make_kb(settings),
                      create_schema=True)


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def wait_status(c, doc_id, want=("ready", "failed")):
    for _ in range(200):
        d = (await c.get(f"/documents/{doc_id}")).json()
        if d["status"] in want:
            return d
        await asyncio.sleep(0.02)
    raise AssertionError(d)


async def upload(c, name, data, ctype="application/octet-stream"):
    return await c.post("/documents", files={"file": (name, data, ctype)})


async def test_upload_list_get_chunk_file_delete(settings):
    app = make(settings)
    async with started(app), client_for(app) as c:
        r = await upload(c, "aurora.md", AURORA_MD, "text/markdown")
        assert r.status_code == 202 and r.json()["status"] == "pending"
        doc = await wait_status(c, r.json()["id"])
        assert doc["status"] == "ready" and doc["chunk_count"] == 1 and doc["embedding_model"] == "test/hash-embeddings"
        assert doc["needs_reindex"] is False and "storage_key" not in doc

        listing = (await c.get("/documents")).json()
        assert [d["id"] for d in listing["documents"]] == [doc["id"]]
        assert listing["knowledge"]["status"] == "ready" and listing["knowledge"]["embedding_dim"] == 256

        chunk = (await c.get(f"/documents/{doc['id']}/chunks/{doc['id']}-c0000")).json()
        assert "137 records" in chunk["text"] and chunk["section"] == "Aurora > Limits"

        f = await c.get(f"/documents/{doc['id']}/file")
        assert f.content == AURORA_MD and f.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in f.headers["content-security-policy"] and f.headers["content-type"].startswith("text/plain")

        assert (await c.post(f"/documents/{doc['id']}/reindex")).status_code == 202
        assert (await wait_status(c, doc["id"]))["status"] == "ready"

        assert (await c.delete(f"/documents/{doc['id']}")).json()["deleted"] is True
        assert (await c.get(f"/documents/{doc['id']}")).status_code == 404
        assert (await c.get("/documents")).json()["documents"] == []


async def test_upload_errors(settings):
    settings.max_upload_mb = 1
    app = make(settings)
    async with started(app), client_for(app) as c:
        assert (await upload(c, "a.exe", b"MZ\x00")).status_code == 415
        assert (await upload(c, "fake.pdf", b"hello")).status_code == 415
        assert (await upload(c, "empty.txt", b"   ")).status_code == 422
        assert (await upload(c, "big.txt", b"a" * (1024 * 1024 + 10))).status_code == 413
        first = await upload(c, "one.txt", b"same bytes here")
        dup = await upload(c, "two.txt", b"same bytes here")
        assert dup.status_code == 409 and dup.json()["detail"]["document_id"] == first.json()["id"]
        bad = await upload(c, "scan.pdf", make_pdf([""]), "application/pdf")
        failed = await wait_status(c, bad.json()["id"])
        assert failed["status"] == "failed" and "OCR" in failed["error"]
        assert (await c.get("/documents/doc_missing/chunks/x")).status_code == 404


async def test_library_events(settings):
    """The SSE route is a thin wrapper over the bus (checked live end to end); httpx's in-process
    transport buffers whole responses, so an endless stream is tested through the bus subscription."""
    app = make(settings)
    async with started(app), client_for(app) as c:
        r = await upload(c, "aurora.md", AURORA_MD)
        await wait_status(c, r.json()["id"])
        await c.delete(f"/documents/{r.json()['id']}")
        bus = app.state.library_events

        async def read(after):
            out = []
            async for e in bus.subscribe("default", after, heartbeat_s=0.05):
                if e is not None:
                    out.append(e)
                if len(out) == 4 - after:
                    return out
        events = await asyncio.wait_for(read(0), 5)
        assert [e.type.value for e in events] == ["document.uploaded", "document.indexing_started",
                                                  "document.indexing_completed", "document.deleted"]
        assert all(e.run_id is None and e.payload["workspace_id"] == "default" for e in events)
        assert [e.seq for e in await asyncio.wait_for(read(2), 5)] == [3, 4]  # resume after a seq
        assert (await c.get("/documents")).json()["events_seq"] == 4
        assert bus.since("other-workspace", 0) == []


async def test_mission_with_documents_evidence_and_scope_validation(settings):
    app = make(settings, lambda: FakeLLM(plan_sources=("documents", "web"), queries=AURORA_QUERIES))
    async with started(app), client_for(app) as c:
        doc = await wait_status(c, (await upload(c, "aurora.md", AURORA_MD)).json()["id"])
        bad = await c.post("/runs", json={"question": "Aurora batch size?", "document_ids": ["doc_nope"]})
        assert bad.status_code == 400 and "doc_nope" in bad.json()["detail"]

        r = await c.post("/runs", json={"question": "What is the Aurora batch size?", "document_ids": [doc["id"]]})
        run_id = r.json()["run_id"]
        assert r.json()["document_scope"] == [doc["id"]]
        assert (await wait_done(c, run_id))["status"] == "completed"
        events = [e for _, e in parse_sse((await c.get(f"/runs/{run_id}/events")).text)]
        types = [e["type"] for e in events]
        assert "rag.retrieval_started" in types and "rag.retrieval_completed" in types
        assert events[0]["payload"]["knowledge"]["documents"][0]["id"] == doc["id"]
        assert "137 records" not in json.dumps(events)  # no passage text over SSE

        ev = (await c.get(f"/runs/{run_id}/evidence")).json()["evidence"]
        d1 = next(e for e in ev if e["id"] == "D1")
        assert d1["kind"] == "document" and d1["document_id"] == doc["id"] and "137 records" in d1["text"]
        assert d1["cited"] and d1["citation_number"]
        report = (await c.get(f"/runs/{run_id}/report")).json()
        assert "aurora.md" in report["markdown"] and any(s.get("kind") == "document" for s in report["sources"])

        # Explicit empty scope = web only.
        r2 = await c.post("/runs", json={"question": "Aurora batch size web only", "document_ids": []})
        await wait_done(c, r2.json()["run_id"])
        t2 = [e["type"] for e in (await c.get(f"/runs/{r2.json()['run_id']}/events.json")).json()]
        assert not [t for t in t2 if t.startswith("rag.")]


async def test_history_survives_restart(settings):
    app1 = make(settings, lambda: FakeLLM(plan_sources=("documents", "web"), queries=AURORA_QUERIES))
    async with started(app1), client_for(app1) as c:
        doc = await wait_status(c, (await upload(c, "aurora.md", AURORA_MD)).json()["id"])
        run_id = (await c.post("/runs", json={"question": "What is the Aurora batch size?"})).json()["run_id"]
        await wait_done(c, run_id)
        n_events = len((await c.get(f"/runs/{run_id}/events.json")).json())
        md = (await c.get(f"/runs/{run_id}/report?format=markdown")).text

    app2 = make(settings)  # new process: nothing in memory, same database and files
    async with started(app2), client_for(app2) as c:
        runs = (await c.get("/runs")).json()["runs"]
        assert runs[0]["run_id"] == run_id and runs[0]["status"] == "completed" and runs[0]["has_report"]
        assert (await c.get(f"/runs/{run_id}")).json()["persisted"] is True
        replay = parse_sse((await c.get(f"/runs/{run_id}/events?after=0")).text)
        assert [s for s, _ in replay] == list(range(1, n_events + 1))
        assert len(parse_sse((await c.get(f"/runs/{run_id}/events?after=5")).text)) == n_events - 5
        assert (await c.get(f"/runs/{run_id}/report?format=markdown")).text == md
        rep = (await c.get(f"/runs/{run_id}/report")).json()
        assert rep["sources"] and rep["sources"][0]["citation_number"] == 1
        ev = (await c.get(f"/runs/{run_id}/evidence")).json()["evidence"]
        assert any(e["kind"] == "document" and e["text"] for e in ev)
        assert (await c.get(f"/documents/{doc['id']}")).json()["status"] == "ready"
        # Deleting the document keeps the citation but removes the stored passage text.
        await c.delete(f"/documents/{doc['id']}")
        ev = (await c.get(f"/runs/{run_id}/evidence")).json()["evidence"]
        d = next(e for e in ev if e["kind"] == "document")
        assert d["document_deleted"] and d["text"] is None and d["title"]


async def test_interrupted_runs_are_marked_on_startup(settings):
    app1 = make(settings)
    async with started(app1):
        await app1.state.missions.create(workspace_id="default", run_id="run_cut", question="q", mode="live",
                                         model="m", document_scope=None)
    app2 = make(settings)
    async with started(app2), client_for(app2) as c:
        r = (await c.get("/runs/run_cut")).json()
        assert r["status"] == "interrupted" and "restarted" in r["error"]


async def test_workspace_isolation_over_http(settings):
    app = make(settings)
    async with started(app), client_for(app) as c:
        doc = await wait_status(c, (await upload(c, "aurora.md", AURORA_MD)).json()["id"])
        run_id = (await c.post("/runs", json={"question": "Compare Postgres and MongoDB"})).json()["run_id"]
        await wait_done(c, run_id)
        await app.state.db.ensure_workspace("intruder")
        app.dependency_overrides[workspace] = lambda: "intruder"
        try:
            assert (await c.get("/documents")).json()["documents"] == []
            for path in (f"/documents/{doc['id']}", f"/documents/{doc['id']}/file",
                         f"/documents/{doc['id']}/chunks/{doc['id']}-c0000", f"/runs/{run_id}",
                         f"/runs/{run_id}/evidence", f"/runs/{run_id}/report"):
                assert (await c.get(path)).status_code == 404, path
            assert (await c.delete(f"/documents/{doc['id']}")).status_code == 404
            assert (await c.get("/runs")).json()["runs"] == []
            r = await c.post("/runs", json={"question": "Aurora batch size?", "document_ids": [doc["id"]]})
            assert r.status_code == 400
        finally:
            app.dependency_overrides.clear()
        assert (await c.get(f"/documents/{doc['id']}")).status_code == 200


@pytest.mark.parametrize("status", ["starting"])
async def test_explicit_scope_requires_ready_knowledge_base(settings, status):
    app = make(settings)
    async with started(app), client_for(app) as c:
        app.state.kb.status = status
        r = await c.post("/runs", json={"question": "Aurora batch size?", "document_ids": ["doc_x"]})
        assert r.status_code == 503
        r = await c.post("/runs", json={"question": "Aurora batch size?"})  # auto scope falls back to web only
        assert r.status_code == 202
        await wait_done(c, r.json()["run_id"])
