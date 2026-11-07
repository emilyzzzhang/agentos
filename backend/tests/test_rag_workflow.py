"""LangGraph workflow with the Knowledge Library: tool use, events, citations, routing, web-only parity."""
import json

from agents.base import AgentContext, KnowledgeScope
from agents.manager import SYSTEM as ALEX_SYSTEM
from events import EventRecorder
from rag.tools import build_document_search_tool
from workflows.runner import run_workflow

from .fakes import FakeLLM, FakeSearch
from .test_rag import AURORA, env, ingest  # noqa: F401  (env is a fixture)


async def scope_for(svc, docs, explicit=True, tool=None):
    return KnowledgeScope(
        workspace_id="default", explicit=explicit,
        documents=[{"id": d.id, "title": d.title, "filename": d.filename, "file_type": d.file_type,
                    "page_count": d.page_count, "chunk_count": d.chunk_count} for d in docs],
        tool=tool or build_document_search_tool(svc.kb.retrieval, workspace_id="default",
                                                document_ids=[d.id for d in docs]))


def ctx_for(settings, llm, search, knowledge=None):
    return AgentContext(run_id="run_k", settings=settings, llm=llm, search=search, knowledge=knowledge,
                        events=EventRecorder("run_k", settings.data_dir / "k.jsonl"))


def of(ctx, t):
    return [e for e in ctx.events.events if e.type.value == t]


async def test_document_research_cites_passages_with_location(env, settings):
    doc = await ingest(env, "default", "aurora.md", AURORA)
    llm = FakeLLM(plan_sources=("documents", "web"),
                  queries=(("What is the maximum batch size in Project Aurora?", "Aurora records limit"), ("q2",)))
    search = FakeSearch()
    ctx = ctx_for(settings, llm, search, await scope_for(env, [doc]))
    final = await run_workflow(ctx, "What is the maximum batch size in Project Aurora per my uploaded spec?")

    # Alex saw the library; subtask 1 went to documents only, subtask 2 to the web only.
    alex_system, alex_prompt = next((s, p) for n, s, p in llm.prompts if n == "ResearchPlan")
    assert "Knowledge Library" in alex_system and "aurora.md" in alex_prompt and "selected these documents" in alex_prompt
    assert search.queries == ["q2"]
    started, done = of(ctx, "rag.retrieval_started"), of(ctx, "rag.retrieval_completed")
    assert [e.payload["query"] for e in started] == ["What is the maximum batch size in Project Aurora?",
                                                     "Aurora records limit"] and len(done) == 2
    assert all(e.agent_id == "milo" and e.task_id == "research-1" for e in started + done)
    assert done[0].payload["results"][0]["document_id"] == doc.id

    # No passage text in any event (metadata only), but the evidence registry keeps it server-side.
    stream = "".join(e.to_json() for e in ctx.events.events)
    assert "137 records" not in stream
    d_ids = [k for k in final["sources"] if k.startswith("D")]
    assert d_ids and all("text" not in final["sources"][k] for k in d_ids)
    assert any("137 records" in (ctx.evidence[k].get("text") or "") for k in d_ids)
    assert any(set(f["source_ids"]) & set(d_ids) for f in final["findings"])

    # Milo's extraction prompt labels passages D# and marks them untrusted.
    milo_system, milo_prompt = next((s, p) for n, s, p in llm.prompts if n == "ResearchFindings")
    assert "untrusted" in milo_system and "[D1] aurora.md" in milo_prompt and "<<<PASSAGE" in milo_prompt

    # Luna's report cites the document with file name + section and links to the evidence viewer.
    md = final["report_markdown"]
    assert "**Uploaded documents**" in md and "**Web sources**" in md
    assert "aurora.md, section \"Aurora > Limits\" (passage D1" in md and "(#evidence-D1)" in md
    assert "Doc fact [[" in md
    assert "D1" in final["cited_sources"]


async def test_web_only_mission_is_unchanged_without_documents(settings):
    llm = FakeLLM(plan_sources=("documents", "both"))  # ignored: no documents in scope
    ctx = ctx_for(settings, llm, FakeSearch())
    final = await run_workflow(ctx, "Compare A and B")
    assert not [e for e in ctx.events.events if e.type.value.startswith("rag.")]
    alex_system = next(s for n, s, p in llm.prompts if n == "ResearchPlan")
    assert alex_system == ALEX_SYSTEM
    assert {st["evidence_source"] for st in final["plan"]["subtasks"]} == {"web"}
    assert all(k.startswith("S") for k in final["sources"])
    md = final["report_markdown"]
    assert "**Uploaded documents**" not in md and "\n1. [" in md  # original numbered source list
    assert of(ctx, "run.started")[0].payload["knowledge"] is None


async def test_luna_can_send_milo_back_to_the_documents(env, settings):
    doc = await ingest(env, "default", "aurora.md", AURORA)
    llm = FakeLLM(verdicts=("revise", "approve"), plan_sources=("web", "web"), follow_up_target="documents")
    search = FakeSearch()
    ctx = ctx_for(settings, llm, search, await scope_for(env, [doc], explicit=False))
    await run_workflow(ctx, "Aurora batch limits")
    assert search.queries == ["q1", "q2", "q1b"]  # web only in round 1
    round2 = [e for e in of(ctx, "rag.retrieval_started") if e.task_id == "research-2"]
    assert [e.payload["query"] for e in round2] == ["fq"]
    assert not [e for e in of(ctx, "tool.started") if e.task_id == "research-2"]
    assert of(ctx, "review.requested")[0].payload["follow_up_target"] == "documents"


async def test_retrieval_failure_is_reported_and_web_research_continues(env, settings):
    doc = await ingest(env, "default", "aurora.md", AURORA)

    class Broken:
        name = "search_documents"

        async def ainvoke(self, *_a, **_k):
            raise RuntimeError("qdrant unreachable")

    ctx = ctx_for(settings, FakeLLM(plan_sources=("both", "web")), FakeSearch(),
                  await scope_for(env, [doc], tool=Broken()))
    final = await run_workflow(ctx, "Aurora batch limits")
    failed = of(ctx, "rag.retrieval_failed")
    assert len(failed) == 2 and "qdrant unreachable" in failed[0].payload["error"]
    assert of(ctx, "run.completed") and final["sources"]


async def test_documents_without_relevant_passages_are_reported_not_guessed(env, settings):
    doc = await ingest(env, "default", "aurora.md", AURORA)
    env.kb.retrieval.min_score = 0.99  # nothing clears the floor
    llm = FakeLLM(plan_sources=("documents", "documents"))
    ctx = ctx_for(settings, llm, FakeSearch(), await scope_for(env, [doc]))
    final = await run_workflow(ctx, "What does the document say about pricing?")
    assert all(e.payload["result_count"] == 0 for e in of(ctx, "rag.retrieval_completed"))
    assert "ResearchFindings" not in llm.calls  # no extraction call without evidence
    done = [e for e in of(ctx, "agent.completed") if e.payload.get("action") == "research"][0]
    assert any("no passages relevant" in g for g in done.payload["gaps"])
    assert final["findings"] == []
    json.dumps(final["sources"])  # serializable
