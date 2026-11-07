import asyncio
import json

import httpx
import pytest

from main import create_app

from .fakes import FakeLLM, FakeSearch, make_kb, started


class SlowSearch(FakeSearch):
    async def search(self, query, context):
        await asyncio.sleep(0.2)
        return await super().search(query, context)


@pytest.fixture
async def app(settings):
    app = create_app(settings, deps=lambda s, mode: (FakeLLM(), SlowSearch()), kb=make_kb(settings), create_schema=True)
    async with started(app):
        yield app


async def wait_done(client, run_id):
    for _ in range(100):
        r = (await client.get(f"/runs/{run_id}")).json()
        if r["status"] != "running":
            return r
        await asyncio.sleep(0.05)
    raise AssertionError("run did not finish")


def parse_sse(text):
    events = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line and not line.startswith(":"))
        if fields.get("event") == "execution":
            events.append((int(fields["id"]), json.loads(fields["data"])))
    return events


async def test_run_lifecycle_sse_and_report(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.post("/runs", json={"question": "Compare Postgres and MongoDB"})
        assert r.status_code == 202
        run_id = r.json()["run_id"]
        assert r.json()["status"] == "running"  # returned before workflow finished

        conflict = await client.post("/runs", json={"question": "Another overlapping mission"})
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["active_run_id"] == run_id

        early = await client.get(f"/runs/{run_id}/report")
        assert early.status_code == 425

        done = await wait_done(client, run_id)
        assert done["status"] == "completed" and done["has_report"]

        sse = await client.get(f"/runs/{run_id}/events")
        assert sse.headers["content-type"].startswith("text/event-stream")
        events = parse_sse(sse.text)
        assert events[0][1]["type"] == "run.started" and events[-1][1]["type"] == "run.completed"
        assert [s for s, _ in events] == list(range(1, len(events) + 1))
        assert "event: end" in sse.text

        resumed = parse_sse((await client.get(f"/runs/{run_id}/events", headers={"Last-Event-ID": "5"})).text)
        assert resumed[0][0] == 6
        resumed2 = parse_sse((await client.get(f"/runs/{run_id}/events?after=7")).text)
        assert resumed2[0][0] == 8

        rep = (await client.get(f"/runs/{run_id}/report")).json()
        assert rep["title"] == "T" and rep["sources"][0]["citation_number"] == 1
        md = await client.get(f"/runs/{run_id}/report?format=markdown")
        assert md.text.startswith("# T")

        assert (await client.get("/runs/nope")).status_code == 404
        assert (await client.post("/runs", json={"question": "short"})).status_code == 422


async def test_missing_api_key_returns_503(settings):
    app = create_app(settings, kb=make_kb(settings), create_schema=True)  # real deps, no key
    async with started(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        r = await client.post("/runs", json={"question": "Compare Postgres and MongoDB"})
        assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
        health = (await client.get("/health")).json()
        assert health["api_key_configured"] is False


async def test_demo_mode_runs_full_graph(settings):
    from workflows.demo import DemoLLM, DemoSearch
    app = create_app(settings, deps=lambda s, mode: (DemoLLM(delay=0), DemoSearch(delay=0)), kb=make_kb(settings),
                     create_schema=True)
    async with started(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        run_id = (await client.post("/runs", json={"question": "Demo question here", "mode": "demo"})).json()["run_id"]
        done = await wait_done(client, run_id)
        assert done["status"] == "completed", done
        events = (await client.get(f"/runs/{run_id}/events.json")).json()
        assert any(e["type"] == "review.requested" for e in events)
        rep = (await client.get(f"/runs/{run_id}/report")).json()
        assert "[DEMO]" in rep["markdown"] and rep["mode"] == "demo"
