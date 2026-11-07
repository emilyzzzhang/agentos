"""LangGraph workflow: Alex -> Milo -> Luna (review) -> [Milo again | Luna report] -> END."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agents.base import AgentContext, WorkflowError
from agents.manager import Manager
from agents.researcher import Researcher, select_queries
from agents.reviewer import Reviewer
from agents.schemas import ResearchPlan
from events import EventType

from .state import OfficeState


def build_graph(ctx: AgentContext):
    alex, milo, luna = Manager(ctx), Researcher(ctx), Reviewer(ctx)
    settings = ctx.settings

    async def alex_plan(state: OfficeState) -> dict:
        try:
            plan = await alex.plan(state["question"])
        except Exception as exc:
            await ctx.events.emit(EventType.AGENT_FAILED, agent_id="alex", task_id="plan", payload={"error": str(exc)})
            raise WorkflowError("alex", str(exc)) from exc
        return {"plan": plan.model_dump(), "revision_count": 0, "sources": {}, "findings": [], "reviews": []}

    async def milo_research(state: OfficeState) -> dict:
        plan = ResearchPlan.model_validate(state["plan"])
        iteration = state.get("revision_count", 0)
        has_docs = ctx.knowledge is not None
        if iteration == 0:
            queries = select_queries(plan, settings.max_queries_initial)
            doc_queries = select_queries(plan, settings.max_doc_queries, ("documents", "both")) if has_docs else []
        else:
            pending = [("follow-up", q) for q in state.get("pending_queries", [])][: settings.max_queries_followup]
            target = state.get("follow_up_target", "web") if has_docs else "web"
            queries = pending if target in ("web", "both") else []
            doc_queries = pending if target in ("documents", "both") else []
        findings, new_sources = await milo.research(
            question=state["question"], plan=plan, iteration=iteration, queries=queries,
            known_sources=state.get("sources", {}), review_notes=state.get("review_notes", []),
            doc_queries=doc_queries,
        )
        return {"sources": new_sources, "findings": [f.model_dump() for f in findings.findings]}

    async def luna_review(state: OfficeState) -> dict:
        plan = ResearchPlan.model_validate(state["plan"])
        rc = state.get("revision_count", 0)
        decision, send_back = await luna.review(
            question=state["question"], plan=plan, findings=state.get("findings", []),
            sources=state.get("sources", {}), revision_count=rc,
        )
        update: dict = {"reviews": [decision.model_dump()], "send_back": send_back}
        if send_back:
            update |= {"revision_count": rc + 1, "pending_queries": decision.follow_up_queries,
                       "follow_up_target": decision.follow_up_target,
                       "review_notes": decision.missing_evidence + decision.unsupported_claims}
        return update

    async def luna_report(state: OfficeState) -> dict:
        plan = ResearchPlan.model_validate(state["plan"])
        report, markdown, cited = await luna.write_report(
            question=state["question"], plan=plan, findings=state.get("findings", []),
            sources=state.get("sources", {}), reviews=state.get("reviews", []),
            revision_count=state.get("revision_count", 0),
        )
        path = settings.data_dir / "reports" / f"{state['run_id']}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding="utf-8")
        await ctx.events.emit(EventType.REPORT_GENERATED, agent_id="luna", task_id="report", payload={
            "title": report.title, "path": str(path), "cited_source_count": len(cited),
            "source_count": len(state.get("sources", {})), "summary": report.summary[:600]})
        await ctx.events.emit(EventType.AGENT_COMPLETED, agent_id="luna", task_id="report", payload={
            "action": "write_report", "summary": f"Published “{report.title}”"})
        return {"report": report.model_dump(), "report_markdown": markdown,
                "report_path": str(path), "cited_sources": cited}

    def route_after_review(state: OfficeState) -> str:
        return "milo_research" if state.get("send_back") else "luna_report"

    g = StateGraph(OfficeState)
    g.add_node("alex_plan", alex_plan)
    g.add_node("milo_research", milo_research)
    g.add_node("luna_review", luna_review)
    g.add_node("luna_report", luna_report)
    g.add_edge(START, "alex_plan")
    g.add_edge("alex_plan", "milo_research")
    g.add_edge("milo_research", "luna_review")
    g.add_conditional_edges("luna_review", route_after_review, ["milo_research", "luna_report"])
    g.add_edge("luna_report", END)
    return g.compile()
