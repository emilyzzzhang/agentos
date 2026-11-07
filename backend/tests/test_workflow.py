import pytest

from agents.base import AgentContext, WorkflowError
from agents.manager import normalize_plan
from agents.schemas import ResearchPlan, Subtask
from events import EventRecorder
from workflows.runner import run_workflow

from .fakes import FakeLLM, FakeSearch


def ctx_for(settings, llm, search):
    return AgentContext(run_id="run_t", settings=settings, llm=llm, search=search,
                        events=EventRecorder("run_t", settings.data_dir / "events.jsonl"))


def types(ctx):
    return [e.type.value for e in ctx.events.events]


async def test_happy_path_event_flow(settings):
    ctx = ctx_for(settings, FakeLLM(), FakeSearch())
    final = await run_workflow(ctx, "Compare A and B")
    t = types(ctx)
    assert t[0] == "run.started" and t[-1] == "run.completed"
    assert t.count("task.assigned") == 3  # alex->milo x2 subtasks, milo->luna x1
    assert "review.requested" not in t
    assert t.index("report.generated") < t.index("run.completed")
    seqs = [e.seq for e in ctx.events.events]
    assert seqs == list(range(1, len(seqs) + 1))
    # every agent/tool event names its agent and task
    for e in ctx.events.events:
        if e.type.value.startswith(("agent.", "tool.", "task.", "review.", "report.")):
            assert e.agent_id in {"alex", "milo", "luna"} and e.task_id
    # sources de-duplicated by URL and report saved
    assert len(final["sources"]) == 4  # q1, q1b, q2 + shared
    assert (settings.data_dir / "reports" / "run_t.md").exists()


async def test_revision_loop_is_bounded(settings):
    search = FakeSearch()
    ctx = ctx_for(settings, FakeLLM(verdicts=("revise",)), search)  # always asks for more
    final = await run_workflow(ctx, "Compare A and B")
    t = types(ctx)
    assert t.count("review.requested") == 2  # max_revisions
    assert final["revision_count"] == 2
    research_tasks = [e.task_id for e in ctx.events.events if e.type.value == "agent.started" and e.agent_id == "milo"]
    assert research_tasks == ["research-1", "research-2", "research-3"]
    last_review = [e for e in ctx.events.events if e.type.value == "agent.completed" and e.task_id == "review-3"][0]
    assert last_review.payload["revision_limit_reached"] is True
    assert t[-1] == "run.completed"


async def test_partial_search_failure_continues(settings):
    ctx = ctx_for(settings, FakeLLM(), FakeSearch(fail_queries={"q2"}))
    await run_workflow(ctx, "Compare A and B")
    t = types(ctx)
    assert t.count("tool.failed") == 1 and t.count("tool.completed") == 2
    assert t[-1] == "run.completed"


async def test_total_search_failure_fails_run(settings):
    ctx = ctx_for(settings, FakeLLM(), FakeSearch(fail_all=True))
    with pytest.raises(WorkflowError):
        await run_workflow(ctx, "Compare A and B")
    t = types(ctx)
    assert "agent.failed" in t and t[-1] == "run.failed"
    failed = [e for e in ctx.events.events if e.type.value == "agent.failed"][0]
    assert failed.agent_id == "milo"


async def test_llm_failure_reports_agent_failed(settings):
    from agents.schemas import ResearchPlan as RP
    ctx = ctx_for(settings, FakeLLM(fail_on=RP), FakeSearch())
    with pytest.raises(WorkflowError):
        await run_workflow(ctx, "Compare A and B")
    failed = [e for e in ctx.events.events if e.type.value == "agent.failed"][0]
    assert failed.agent_id == "alex" and types(ctx)[-1] == "run.failed"


async def test_citations_are_validated(settings):
    ctx = ctx_for(settings, FakeLLM(bad_citations=True), FakeSearch())
    final = await run_workflow(ctx, "Compare A and B")
    # uncited finding dropped, unknown id stripped
    assert all(set(f["source_ids"]) <= set(final["sources"]) for f in final["findings"])
    assert all(f["claim"] != "uncited" for f in final["findings"])
    md = final["report_markdown"]
    assert "S77" not in md and "[[1]](https://" in md and "## Sources" in md
    assert "## Answer" in md and "## Key findings" in md and "- Fact [[1]]" in md
    assert "Not verified (no valid source): Uncited claim" in md and "Not verified (no valid source): Fake only" in md
    assert md.index("## Key findings") < md.index("## Recommendation") < md.index("## Limitations")
    assert "and fake." in md  # stripped invalid citation leaves no stray space
    assert final["cited_sources"] == ["S1", "S2"]


def test_normalize_plan_bounds():
    plan = ResearchPlan(objective="o", approach="a", success_criteria=[], subtasks=[
        Subtask(id="Same!", title=f"t{i}", description="d", search_queries=["a", "b", "c", " "]) for i in range(6)])
    p = normalize_plan(plan)
    assert len(p.subtasks) == 4
    assert len({s.id for s in p.subtasks}) == 4
    assert all(len(s.search_queries) <= 2 for s in p.subtasks)
