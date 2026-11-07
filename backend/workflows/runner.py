"""Executes one LangGraph run and brackets it with run.* lifecycle events."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from agents.base import AgentContext, WorkflowError
from events import EventType

from .graph import build_graph


async def run_workflow(ctx: AgentContext, question: str, *, mode: str = "live") -> dict[str, Any]:
    ev = ctx.events
    started = time.monotonic()
    await ev.emit(EventType.RUN_STARTED, payload={
        "question": question, "mode": mode,
        "model": ctx.settings.model if mode == "live" else "demo-script",
        "search_provider": ctx.search.name, "max_revisions": ctx.settings.max_revisions,
        "agents": ["alex", "milo", "luna"],
        # Document metadata only (IDs and titles), never content.
        "knowledge": {"document_count": len(ctx.knowledge.documents), "explicit": ctx.knowledge.explicit,
                      "documents": [{"id": d["id"], "title": d["title"], "filename": d["filename"]}
                                    for d in ctx.knowledge.documents[:50]]} if ctx.knowledge else None})
    graph = build_graph(ctx)
    try:
        final = await graph.ainvoke({"run_id": ctx.run_id, "question": question}, config={"recursion_limit": 30})
    except asyncio.CancelledError:
        await ev.emit(EventType.RUN_FAILED, payload={"error": "Run was cancelled", "agent_id": None})
        raise
    except WorkflowError as exc:
        await ev.emit(EventType.RUN_FAILED, payload={"error": exc.message, "failed_agent": exc.agent_id})
        raise
    except Exception as exc:
        await ev.emit(EventType.RUN_FAILED, payload={"error": f"{type(exc).__name__}: {exc}"})
        raise
    await ev.emit(EventType.RUN_COMPLETED, payload={
        "title": final.get("report", {}).get("title"),
        "duration_s": round(time.monotonic() - started, 1),
        "research_rounds": final.get("revision_count", 0) + 1,
        "source_count": len(final.get("sources", {})),
        "finding_count": len(final.get("findings", [])),
    })
    return final
