from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from agents.base import AGENTS
from agents.llm import LLMError
from agents.sources import classify
from db.missions import MissionStore, evidence_row_to_dict, mission_summary
from events import ExecutionEvent
from tools.web_search import SearchError

from .deps import workspace
from .manager import RunConflictError, RunManager, RunRecord, ScopeError

router = APIRouter()
HEARTBEAT_S = 10.0


class StartRun(BaseModel):
    question: str = Field(min_length=8, max_length=2000)
    mode: Literal["live", "demo"] = "live"
    # null: all ready documents in the library; []: web only; [ids]: only these documents
    document_ids: list[str] | None = Field(default=None, max_length=100)


def manager(request: Request) -> RunManager:
    return request.app.state.runs


def store(request: Request) -> MissionStore:
    return request.app.state.missions


def sse(event: ExecutionEvent) -> str:
    return f"id: {event.seq}\nevent: execution\ndata: {event.to_json()}\n\n"


@router.get("/health")
async def health(request: Request):
    s = request.app.state.settings
    m = manager(request)
    kb = request.app.state.kb
    return {"ok": True, "model": s.model, "search_provider": s.search_provider,
            "api_key_configured": s.has_api_key, "demo_enabled": s.enable_demo,
            "active_run_id": m.active.run_id if m.active else None, "agents": AGENTS,
            "max_revisions": s.max_revisions, "workspace_id": s.workspace_id, "database": "ok",
            "knowledge": kb.info() if kb else None}


@router.post("/runs", status_code=202)
async def start_run(body: StartRun, request: Request, ws: str = Depends(workspace)):
    s = request.app.state.settings
    if body.mode == "demo" and not s.enable_demo:
        raise HTTPException(400, "Demo mode is disabled (AGENTOS_ENABLE_DEMO=false).")
    ids = list(dict.fromkeys(body.document_ids)) if body.document_ids is not None else None
    try:
        rec = await manager(request).start(body.question.strip(), body.mode, document_ids=ids, workspace_id=ws)
    except RunConflictError as exc:
        raise HTTPException(409, {"message": "A mission is already running in this office.",
                                  "active_run_id": exc.active_run_id})
    except ScopeError as exc:
        raise HTTPException(exc.status, str(exc))
    except (LLMError, SearchError) as exc:
        raise HTTPException(503, str(exc))
    return rec.summary()


@router.get("/runs")
async def list_runs(request: Request, ws: str = Depends(workspace), limit: int = Query(30, ge=1, le=200)):
    """Mission history for this workspace, newest first (from PostgreSQL; live runs overlay their state)."""
    m = manager(request)
    out = []
    for row in await store(request).list(ws, limit):
        live = m.get(row.id, ws)
        out.append(live.summary() if live else mission_summary(row))
    return {"runs": out}


async def _lookup(request: Request, run_id: str, ws: str) -> tuple[RunRecord | None, object]:
    """In-memory run first (current process), then persisted history. 404 if neither, or another workspace."""
    rec = manager(request).get(run_id, ws)
    if rec:
        return rec, None
    row = await store(request).get(ws, run_id)
    if row is None:
        raise HTTPException(404, "run not found")
    return None, row


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request, ws: str = Depends(workspace)):
    rec, row = await _lookup(request, run_id, ws)
    return rec.summary() if rec else mission_summary(row)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request, ws: str = Depends(workspace)):
    rec, _ = await _lookup(request, run_id, ws)
    return {"cancelled": await manager(request).cancel(run_id) if rec else False}


@router.get("/runs/{run_id}/events")
async def stream_events(
    run_id: str, request: Request,
    after: int | None = Query(None, ge=0, description="Replay events with seq greater than this"),
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
    ws: str = Depends(workspace),
):
    rec, row = await _lookup(request, run_id, ws)
    cursor = after or 0
    if last_event_id and last_event_id.isdigit():  # browser auto-reconnect
        cursor = max(cursor, int(last_event_id))

    if rec is None:  # finished before this server process started: replay from PostgreSQL
        history = await store(request).events(ws, run_id, cursor)

        async def replay():
            yield "retry: 2000\n\n"
            for e in history:
                yield sse(e)
            yield f"event: end\ndata: {{\"run_id\": \"{run_id}\", \"status\": \"{row.status}\"}}\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def gen():
        yield "retry: 2000\n\n"
        async for event in rec.recorder.subscribe(after_seq=cursor, heartbeat_s=HEARTBEAT_S):
            if await request.is_disconnected():
                return
            if event is None:
                # Named event (not an SSE comment) so browser clients can run a liveness watchdog.
                yield "event: heartbeat\ndata: {}\n\n"
                continue
            yield sse(event)
        yield f"event: end\ndata: {{\"run_id\": \"{run_id}\", \"status\": \"{rec.status}\"}}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}/events.json")
async def list_events(run_id: str, request: Request, after: int = Query(0, ge=0), ws: str = Depends(workspace)):
    rec, _ = await _lookup(request, run_id, ws)
    events = rec.recorder.since(after) if rec else await store(request).events(ws, run_id, after)
    return [e.model_dump(mode="json") for e in events]


@router.get("/runs/{run_id}/evidence")
async def get_evidence(run_id: str, request: Request, ws: str = Depends(workspace)):
    """All evidence a mission gathered: web sources (S#) and document passages (D#, with passage text)."""
    rec, _ = await _lookup(request, run_id, ws)
    if rec is None:
        return {"run_id": run_id, "evidence": [evidence_row_to_dict(e) for e in await store(request).evidence(ws, run_id)]}
    cited = (rec.result or {}).get("cited_sources") or []
    items = []
    for eid, src in (rec.ctx.evidence if rec.ctx else {}).items():
        items.append({
            "id": eid, "kind": src.get("kind", "web"),
            "title": (src.get("filename") if src.get("kind") == "document" else None) or src.get("title"),
            "url": src.get("url") or None,
            "document_id": src.get("document_id"), "chunk_id": src.get("chunk_id"), "page": src.get("page"),
            "section": src.get("section"), "query": src.get("query"), "score": src.get("score"),
            "text": src.get("text") if src.get("kind") == "document" else src.get("snippet"),
            "cited": eid in cited, "citation_number": cited.index(eid) + 1 if eid in cited else None,
            "document_deleted": False,
            "source_type": classify(src["url"]) if src.get("kind", "web") == "web" and src.get("url") else None})
    items.sort(key=lambda e: (e["kind"] != "document", e["id"][0], int(e["id"][1:] or 0)))
    return {"run_id": run_id, "evidence": items}


@router.get("/runs/{run_id}/report")
async def get_report(run_id: str, request: Request, format: Literal["json", "markdown"] = "json",
                     ws: str = Depends(workspace)):
    rec, row = await _lookup(request, run_id, ws)
    if rec is None:
        if not row.report_markdown:
            raise HTTPException(404, f"no report (run {row.status}: {row.error})")
        if format == "markdown":
            return PlainTextResponse(row.report_markdown, media_type="text/markdown")
        ev = [e for e in await store(request).evidence(ws, run_id) if e.cited]
        ev.sort(key=lambda e: e.citation_number or 0)
        return {"run_id": run_id, "title": row.report_title, "markdown": row.report_markdown, "path": row.report_path,
                "mode": row.mode, "sources": [evidence_row_to_dict(e, include_text=False) for e in ev]}
    if rec.status == "running":
        raise HTTPException(425, "report not ready yet")
    if not rec.result or not rec.result.get("report_markdown"):
        raise HTTPException(404, f"no report (run {rec.status}: {rec.error})")
    md = rec.result["report_markdown"]
    if format == "markdown":
        return PlainTextResponse(md, media_type="text/markdown")
    sources = rec.result.get("sources", {})
    cited = rec.result.get("cited_sources", [])
    return {"run_id": run_id, "title": rec.result["report"]["title"], "markdown": md,
            "path": rec.result.get("report_path"), "mode": rec.mode,
            "sources": [sources[i] | {"citation_number": n, "source_type": classify(sources[i]["url"])
                                      if sources[i].get("kind", "web") == "web" and sources[i].get("url") else None}
                        for n, i in enumerate(cited, 1) if i in sources],
            "report_type": (rec.result.get("report") or {}).get("report_type")}
