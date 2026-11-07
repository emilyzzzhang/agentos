"""Persistence for missions, their execution events, and their evidence. All reads filter by workspace."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import sqlalchemy as sa

from agents.sources import classify
from events.models import ExecutionEvent

from .models import Mission, MissionEvent, MissionEvidence
from .session import Database

log = logging.getLogger(__name__)


def mission_summary(m: Mission, *, last_seq: int | None = None) -> dict[str, Any]:
    """Same shape as RunRecord.summary() for runs that are no longer in memory."""
    return {
        "run_id": m.id, "question": m.question, "mode": m.mode, "status": m.status, "error": m.error,
        "created_at": m.created_at, "finished_at": m.finished_at,
        "last_seq": m.event_count if last_seq is None else last_seq, "event_count": m.event_count,
        "plan": m.plan, "report_title": m.report_title, "research_rounds": m.research_rounds,
        "source_count": m.source_count, "has_report": bool(m.report_markdown),
        "document_scope": m.document_scope, "persisted": True,
    }


def evidence_row_to_dict(e: MissionEvidence, *, include_text: bool = True) -> dict[str, Any]:
    d = {
        "id": e.evidence_id, "kind": e.kind, "title": e.title, "url": e.url, "document_id": e.document_id,
        "chunk_id": e.chunk_id, "page": e.page, "section": e.section, "query": e.query, "score": e.score,
        "cited": e.cited, "citation_number": e.citation_number,
        "document_deleted": e.kind == "document" and e.document_id is None,
        "source_type": classify(e.url) if e.kind == "web" and e.url else None,
    }
    if include_text:
        d["text"] = e.text
    return d


class MissionStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, *, workspace_id: str, run_id: str, question: str, mode: str, model: str | None,
                     document_scope: list[str] | None) -> None:
        async with self.db.sessions() as s:
            s.add(Mission(id=run_id, workspace_id=workspace_id, question=question, mode=mode, status="running",
                          model=model, document_scope=document_scope))
            await s.commit()

    async def add_event(self, event: ExecutionEvent) -> None:
        async with self.db.sessions() as s:
            s.add(MissionEvent(id=event.id, mission_id=event.run_id, seq=event.seq, type=event.type.value,
                               agent_id=event.agent_id, task_id=event.task_id,
                               payload=event.model_dump(mode="json")["payload"], timestamp=event.timestamp))
            await s.execute(sa.update(Mission).where(Mission.id == event.run_id).values(event_count=event.seq))
            await s.commit()

    async def finish(self, *, run_id: str, status: str, error: str | None, result: dict[str, Any] | None,
                     evidence: dict[str, dict], workspace_id: str) -> None:
        r = result or {}
        cited: list[str] = r.get("cited_sources") or []
        async with self.db.sessions() as s:
            m = await s.get(Mission, run_id)
            if m is None:
                return
            m.status, m.error, m.finished_at = status, error, datetime.now(timezone.utc)
            if r:
                m.plan = r.get("plan")
                m.report_title = (r.get("report") or {}).get("title")
                m.report_path = r.get("report_path")
                m.report_markdown = r.get("report_markdown")
                m.cited_sources = cited
                m.research_rounds = r.get("revision_count", 0) + 1
                m.source_count = len(r.get("sources") or {})
            await s.execute(sa.delete(MissionEvidence).where(MissionEvidence.mission_id == run_id))
            for eid, src in evidence.items():
                s.add(MissionEvidence(
                    mission_id=run_id, evidence_id=eid, workspace_id=workspace_id, kind=src.get("kind", "web"),
                    # Document evidence is labeled by file name, matching the report's Sources list.
                    title=(src.get("filename") if src.get("kind") == "document" else None) or src.get("title")
                    or src.get("url") or eid, url=src.get("url") or None,
                    document_id=src.get("document_id"), chunk_id=src.get("chunk_id"), page=src.get("page"),
                    section=src.get("section"), query=src.get("query"), score=src.get("score"),
                    text=src.get("text") if src.get("kind") == "document" else (src.get("snippet") or None),
                    cited=eid in cited, citation_number=cited.index(eid) + 1 if eid in cited else None))
            await s.commit()

    async def mark_interrupted(self) -> int:
        """Runs only live in process memory; any 'running' row at startup was cut off by a restart."""
        async with self.db.sessions() as s:
            res = await s.execute(sa.update(Mission).where(Mission.status == "running").values(
                status="interrupted", error="The server restarted while this mission was running.",
                finished_at=datetime.now(timezone.utc)))
            await s.commit()
            return res.rowcount or 0

    async def get(self, workspace_id: str, run_id: str) -> Mission | None:
        async with self.db.sessions() as s:
            return (await s.execute(sa.select(Mission).where(
                Mission.id == run_id, Mission.workspace_id == workspace_id))).scalar_one_or_none()

    async def list(self, workspace_id: str, limit: int = 50) -> list[Mission]:
        async with self.db.sessions() as s:
            rows = await s.execute(sa.select(Mission).where(Mission.workspace_id == workspace_id)
                                   .order_by(Mission.created_at.desc()).limit(limit))
            return list(rows.scalars())

    async def events(self, workspace_id: str, run_id: str, after: int = 0) -> list[ExecutionEvent]:
        async with self.db.sessions() as s:
            rows = await s.execute(
                sa.select(MissionEvent).join(Mission).where(
                    Mission.id == run_id, Mission.workspace_id == workspace_id, MissionEvent.seq > after)
                .order_by(MissionEvent.seq))
            return [ExecutionEvent(id=e.id, run_id=e.mission_id, seq=e.seq, timestamp=e.timestamp, type=e.type,
                                   agent_id=e.agent_id, task_id=e.task_id, payload=e.payload)
                    for e in rows.scalars()]

    async def evidence(self, workspace_id: str, run_id: str) -> list[MissionEvidence]:
        async with self.db.sessions() as s:
            rows = await s.execute(sa.select(MissionEvidence).where(
                MissionEvidence.mission_id == run_id, MissionEvidence.workspace_id == workspace_id))
            items = list(rows.scalars())
        return sorted(items, key=lambda e: (e.kind != "document", e.evidence_id[0], int(e.evidence_id[1:] or 0)))
