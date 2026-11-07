"""Demo mode: scripted agents and fake search results, for trying the office without an API key.

Runs through the same LangGraph workflow and event pipeline as live missions. Sources use the
reserved `.invalid` domain and the report is marked as demo content.
"""
from __future__ import annotations

import asyncio
import random

from agents.schemas import (FinalReport, Finding, ReportSection, ResearchFindings, ResearchPlan, ReviewDecision,
                            Subtask)
from tools.web_search import SearchResult, SourceDoc


class DemoLLM:
    def __init__(self, delay: float = 2.0) -> None:
        self.delay = delay
        self.reviews = 0

    async def generate(self, *, agent_id, schema, system, prompt, effort):
        await asyncio.sleep(self.delay * random.uniform(0.8, 1.3))
        q = prompt.split("\n", 2)[1] if prompt.startswith("User request:") else "the request"
        if schema is ResearchPlan:
            return ResearchPlan(
                objective=f"[DEMO] Answer: {q[:120]}",
                approach="[DEMO] Scripted plan. Configure ANTHROPIC_API_KEY for real planning.",
                subtasks=[
                    Subtask(id="st1", title="Gather core facts", description="Demo subtask",
                            search_queries=["demo query: core facts"],
                            # With documents in scope, the demo also exercises real Knowledge Library retrieval.
                            evidence_source="both" if "Knowledge Library" in system else "web"),
                    Subtask(id="st2", title="Compare trade-offs", description="Demo subtask",
                            search_queries=["demo query: trade-offs"]),
                    Subtask(id="st3", title="Check real-world usage", description="Demo subtask",
                            search_queries=["demo query: case studies"]),
                ],
                success_criteria=["Demo criterion"],
            )
        if schema is ResearchFindings:
            ids = sorted({x.split("]")[0] for x in prompt.split("\n[")[1:] if x[:1] in ("S", "D")})[:4] or ["S1"]
            return ResearchFindings(
                summary="[DEMO] Synthetic findings — not real research.",
                findings=[Finding(claim=f"[DEMO] Synthetic finding {i + 1}", evidence="Placeholder evidence",
                                  source_ids=[sid], subtask_id="st1", confidence="medium")
                          for i, sid in enumerate(ids)],
                gaps=["[DEMO] Synthetic gap"],
            )
        if schema is ReviewDecision:
            self.reviews += 1
            if self.reviews == 1:
                return ReviewDecision(verdict="revise", assessment="[DEMO] Requesting one follow-up round.",
                                      missing_evidence=["[DEMO] More recent data"], unsupported_claims=[],
                                      follow_up_queries=["demo query: recent benchmarks"])
            return ReviewDecision(verdict="approve", assessment="[DEMO] Evidence is sufficient.",
                                  missing_evidence=[], unsupported_claims=[], follow_up_queries=[])
        if schema is FinalReport:
            return FinalReport(
                title="[DEMO] Scripted report",
                summary="This is demo content. No AI model or web search was used [S1].",
                findings=["The workflow ran with scripted agents and synthetic sources [S1][S3].",
                          "This finding has no valid source, so the renderer moves it to limitations."],
                analysis=[ReportSection(heading="What this run shows",
                                        content="The event pipeline, the review loop, and the report renderer ran end to end [S1]. "
                                                "The research content is synthetic.")],
                recommendation="Add `ANTHROPIC_API_KEY` to `backend/.env` and start a live mission [S2].",
                limitations=["All content in this report is synthetic."],
            )
        raise ValueError(f"demo has no script for {schema}")


class DemoSearch:
    name = "demo_search"

    def __init__(self, delay: float = 1.5) -> None:
        self.delay = delay
        self.n = 0

    async def search(self, query: str, context: str) -> SearchResult:
        await asyncio.sleep(self.delay * random.uniform(0.7, 1.4))
        self.n += 1
        docs = [SourceDoc(url=f"https://demo-source-{self.n}-{i}.invalid/", title=f"[DEMO] Synthetic source {self.n}.{i}",
                          snippet="Synthetic snippet") for i in range(1, 3)]
        return SearchResult(query=query, provider=self.name, sources=docs, summary="[DEMO] synthetic digest",
                            executed_queries=[query])
