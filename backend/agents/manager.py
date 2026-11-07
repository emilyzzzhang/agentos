"""Alex - Manager: turns the user's request into a structured research plan."""
from __future__ import annotations

import re

from events import EventType

from .base import AgentContext
from .schemas import ResearchPlan

SYSTEM = """You are Alex, the engagement manager of a small research team (Milo researches, Luna reviews).
Turn the user's request into a focused, executable research plan.
- 2-4 subtasks, each answerable through web research, together covering the whole request.
- Each subtask gets 1-2 precise web search queries (include product names, versions, years when relevant).
- Success criteria describe what the final report must contain to fully answer the request.
Be concrete and avoid redundant subtasks.

Also classify the request (task_type):
- comparison: the user chooses between named options (tools, approaches, products).
- study_plan: the user wants a schedule to learn something or prepare for an exam or interview.
- how_to: the user wants steps to do something.
- explanation: the user wants to understand how or why something works (a concept, mechanism, or system).
- summary: the user wants a summary of their uploaded documents.
- research: any other question that needs an evidence-based answer.
If the request omits a detail that changes the answer (for example the interview role or level, the deadline or
time available, the budget, the scale, the version), do not invent it. Record a reasonable default in assumptions
and add at most 2 focused clarifying_questions. Leave both empty when nothing essential is missing.
Prefer queries that reach primary sources: official documentation, specifications, release notes, papers."""

KNOWLEDGE_RULES = """
Knowledge Library: the user has uploaded documents that Milo can search with semantic retrieval.
For every subtask, set evidence_source:
- "documents" when the answer should come from the uploaded documents: the user refers to "the document",
  "my files", "the uploaded report", an internal project, or facts unlikely to be public.
- "web" when the subtask needs public, external, or current information.
- "both" when the user asks to verify or compare document content against external sources.
If the user explicitly asks about the uploaded documents, prioritize "documents" and add web research only if
they also ask for external context or verification.
For document subtasks, write search_queries as specific natural-language questions (they are embedded and
matched against passages), not as keyword web queries."""


def knowledge_prompt(docs: list[dict], explicit: bool) -> str:
    listing = "\n".join(
        f"- {d['title']} ({d['filename']}, {d['file_type']}"
        + (f", {d['page_count']} pages" if d.get("page_count") else "") + f", {d['chunk_count']} passages)"
        for d in docs[:30])
    more = f"\n- ... and {len(docs) - 30} more" if len(docs) > 30 else ""
    who = "The user selected these documents for this mission" if explicit else "Documents available in the library"
    return f"\n\n{who}:\n{listing}{more}"


class Manager:
    agent_id = "alex"

    def __init__(self, ctx: AgentContext) -> None:
        self.ctx = ctx

    async def plan(self, question: str) -> ResearchPlan:
        ev = self.ctx.events
        await ev.emit(EventType.AGENT_STARTED, agent_id="alex", task_id="plan",
                      payload={"action": "planning", "summary": "Breaking the request into research subtasks"})
        kn = self.ctx.knowledge
        system = SYSTEM + KNOWLEDGE_RULES if kn else SYSTEM  # web-only missions keep the original prompt
        prompt = f"User request:\n{question}" + (knowledge_prompt(kn.documents, kn.explicit) if kn else "")
        plan = await self.ctx.llm.generate(
            agent_id="alex", schema=ResearchPlan, system=system, prompt=prompt, effort=self.ctx.settings.effort_manager,
        )
        plan = normalize_plan(plan, documents_available=kn is not None)
        await ev.emit(EventType.AGENT_COMPLETED, agent_id="alex", task_id="plan",
                      payload={"action": "planning", "summary": f"Created a {len(plan.subtasks)}-step research plan",
                               "plan": plan.model_dump()})
        for st in plan.subtasks:
            await ev.emit(EventType.TASK_ASSIGNED, agent_id="alex", task_id=st.id, payload={
                "from_agent": "alex", "to_agent": "milo", "title": st.title,
                "description": st.description, "search_queries": st.search_queries,
                "evidence_source": st.evidence_source,
            })
        return plan


def normalize_plan(plan: ResearchPlan, documents_available: bool = False) -> ResearchPlan:
    """Enforce bounds and stable ids regardless of what the model returned."""
    subtasks = []
    for i, st in enumerate(plan.subtasks[:4], start=1):
        queries = [q.strip() for q in st.search_queries if q and q.strip()][:2] or [st.title]
        sid = re.sub(r"[^a-z0-9-]", "", st.id.lower()) or f"st{i}"
        source = st.evidence_source if documents_available else "web"
        subtasks.append(st.model_copy(update={"id": f"st{i}" if sid in {s.id for s in subtasks} else sid,
                                              "search_queries": queries, "evidence_source": source}))
    if not subtasks:
        raise ValueError("plan contained no subtasks")
    return plan.model_copy(update={"subtasks": subtasks})
