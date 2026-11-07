"""In-process run manager.

Missions, events and evidence are saved to PostgreSQL as they happen, but execution is not durable.
Runs live in this process, so a restart marks them `interrupted`. Only one run is active at a time
(others get HTTP 409), and the server must use a single uvicorn worker.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Literal
from uuid import uuid4

from agents.base import AgentContext, KnowledgeScope
from agents.llm import ClaudeStructuredLLM, StructuredLLM
from config import Settings
from db.missions import MissionStore
from events import EventRecorder
from rag.documents import DocumentService
from rag.knowledge import KnowledgeBase
from rag.tools import build_document_search_tool
from tools.web_search import SearchProvider, build_search_provider
from workflows.demo import DemoLLM, DemoSearch
from workflows.runner import run_workflow

log = logging.getLogger(__name__)
RunStatus = Literal["running", "completed", "failed", "cancelled"]


class ScopeError(ValueError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class RunConflictError(RuntimeError):
    def __init__(self, active_run_id: str) -> None:
        super().__init__(f"run {active_run_id} is still active")
        self.active_run_id = active_run_id


@dataclass
class RunRecord:
    run_id: str
    question: str
    mode: str
    recorder: EventRecorder
    workspace_id: str = "default"
    ctx: AgentContext | None = None
    document_scope: list[str] | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    status: RunStatus = "running"
    error: str | None = None
    result: dict[str, Any] | None = None
    task: asyncio.Task | None = None
    finished_at: datetime | None = None

    def summary(self) -> dict[str, Any]:
        r = self.result or {}
        return {
            "run_id": self.run_id, "question": self.question, "mode": self.mode, "status": self.status,
            "error": self.error, "created_at": self.created_at, "finished_at": self.finished_at,
            "last_seq": self.recorder.last_seq, "event_count": len(self.recorder.events),
            "plan": r.get("plan"), "report_title": (r.get("report") or {}).get("title"),
            "research_rounds": r.get("revision_count", 0) + 1 if r else None,
            "source_count": len(r.get("sources", {})) if r else None,
            "has_report": bool(r.get("report_markdown")),
            "document_scope": self.document_scope, "persisted": True,
        }


Deps = Callable[[Settings, str], tuple[StructuredLLM, SearchProvider]]


def live_deps(settings: Settings, mode: str) -> tuple[StructuredLLM, SearchProvider]:
    if mode == "demo":
        return DemoLLM(), DemoSearch()
    return ClaudeStructuredLLM(settings), build_search_provider(settings)


class RunManager:
    def __init__(self, settings: Settings, deps: Deps = live_deps, *, store: MissionStore,
                 documents: DocumentService | None = None, kb: KnowledgeBase | None = None) -> None:
        self.settings = settings
        self.deps = deps
        self.store = store
        self.documents = documents
        self.kb = kb
        self.runs: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()

    @property
    def active(self) -> RunRecord | None:
        return next((r for r in self.runs.values() if r.status == "running"), None)

    async def _knowledge_scope(self, workspace_id: str, document_ids: list[str] | None) -> KnowledgeScope | None:
        """null -> every ready document in the workspace; [] -> web only; [ids] -> exactly those documents."""
        if document_ids is not None and not document_ids:
            return None
        if self.documents is None or self.kb is None:
            if document_ids:
                raise ScopeError(503, "The Knowledge Library is not configured.")
            return None
        if self.kb.status != "ready":
            if document_ids:
                raise ScopeError(503, f"The Knowledge Library is {self.kb.status}: {self.kb.error or 'try again shortly'}")
            return None  # web-only mission; noted in run.started
        ready = await self.documents.ready_documents(workspace_id, document_ids)
        if document_ids:
            missing = sorted(set(document_ids) - {d.id for d in ready})
            if missing:
                raise ScopeError(400, "These documents are not indexed and ready, or do not exist: " + ", ".join(missing))
        if not ready:
            return None
        ids = [d.id for d in ready]
        _, retrieval = self.kb.require()
        return KnowledgeScope(
            workspace_id=workspace_id, explicit=bool(document_ids),
            documents=[{"id": d.id, "title": d.title, "filename": d.filename, "file_type": d.file_type,
                        "page_count": d.page_count, "chunk_count": d.chunk_count} for d in ready],
            tool=build_document_search_tool(retrieval, workspace_id=workspace_id, document_ids=ids))

    async def start(self, question: str, mode: str = "live", *, document_ids: list[str] | None = None,
                    workspace_id: str | None = None) -> RunRecord:
        ws = workspace_id or self.settings.workspace_id
        async with self._lock:
            if (active := self.active) is not None:
                raise RunConflictError(active.run_id)
            llm, search = self.deps(self.settings, mode)  # raises on missing key before anything starts
            knowledge = await self._knowledge_scope(ws, document_ids)
            run_id = f"run_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}_{uuid4().hex[:6]}"
            await self.store.create(workspace_id=ws, run_id=run_id, question=question, mode=mode,
                                    model=self.settings.model if mode == "live" else "demo-script",
                                    document_scope=document_ids)
            recorder = EventRecorder(run_id, self.settings.data_dir / "events" / f"{run_id}.jsonl",
                                     sink=self.store.add_event)
            ctx = AgentContext(run_id=run_id, settings=self.settings, llm=llm, search=search, events=recorder,
                               knowledge=knowledge)
            rec = RunRecord(run_id=run_id, question=question, mode=mode, recorder=recorder, workspace_id=ws,
                            ctx=ctx, document_scope=document_ids)
            self.runs[run_id] = rec
            rec.task = asyncio.create_task(self._execute(rec, ctx), name=run_id)
            return rec

    async def _execute(self, rec: RunRecord, ctx: AgentContext) -> None:
        try:
            rec.result = await run_workflow(ctx, rec.question, mode=rec.mode)
            rec.status = "completed"
        except asyncio.CancelledError:
            rec.status = "cancelled"
            rec.error = "cancelled"
        except Exception as exc:  # already surfaced as run.failed
            log.exception("run %s failed", rec.run_id)
            rec.status = "failed"
            rec.error = str(exc)
        finally:
            rec.finished_at = datetime.now(timezone.utc)
            try:
                await self.store.finish(run_id=rec.run_id, status=rec.status, error=rec.error, result=rec.result,
                                        evidence=ctx.evidence, workspace_id=rec.workspace_id)
            except Exception:
                log.exception("could not persist the result of run %s", rec.run_id)

    async def recover(self) -> int:
        return await self.store.mark_interrupted()

    def get(self, run_id: str, workspace_id: str | None = None) -> RunRecord | None:
        rec = self.runs.get(run_id)
        if rec and workspace_id is not None and rec.workspace_id != workspace_id:
            return None
        return rec

    async def cancel(self, run_id: str) -> bool:
        rec = self.runs.get(run_id)
        if not rec or rec.status != "running" or not rec.task:
            return False
        rec.task.cancel()
        try:
            await rec.task
        except asyncio.CancelledError:
            pass
        return True

    async def shutdown(self) -> None:
        for rec in list(self.runs.values()):
            if rec.status == "running":
                await self.cancel(rec.run_id)
