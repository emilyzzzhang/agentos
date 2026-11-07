"""Test doubles (never used by the running application)."""
from __future__ import annotations

import re

from agents.schemas import (FinalReport, Finding, ReportSection, ResearchFindings, ResearchPlan, ReviewDecision,
                            Subtask)
from tools.web_search import SearchError, SearchResult, SourceDoc


class FakeLLM:
    def __init__(self, verdicts=("approve",), bad_citations=False, fail_on=None, plan_sources=("web", "web"),
                 follow_up_target="web", queries=(("q1", "q1b"), ("q2",))):
        self.verdicts = list(verdicts)
        self.calls: list[str] = []
        self.prompts: list[tuple[str, str, str]] = []  # (schema, system, prompt)
        self.bad_citations = bad_citations
        self.fail_on = fail_on
        self.plan_sources = plan_sources
        self.follow_up_target = follow_up_target
        self.queries = queries

    async def generate(self, *, agent_id, schema, system, prompt, effort):
        self.calls.append(schema.__name__)
        self.prompts.append((schema.__name__, system, prompt))
        if self.fail_on is schema:
            raise RuntimeError("boom")
        if schema is ResearchPlan:
            return ResearchPlan(objective="o", approach="a", success_criteria=["c"], subtasks=[
                Subtask(id="st1", title="A", description="d", search_queries=list(self.queries[0]),
                        evidence_source=self.plan_sources[0]),
                Subtask(id="st2", title="B", description="d", search_queries=list(self.queries[1]),
                        evidence_source=self.plan_sources[1]),
            ])
        if schema is ResearchFindings:
            avail = re.findall(r"^\[([SD]\d+)\]", prompt, re.M)  # cite what the prompt actually offers
            ids = ([i for i in avail if i[0] == "S"][:1] + [i for i in avail if i[0] == "D"][:1]) or ["S1"]
            ids = ids + ["S99"] if self.bad_citations else ids
            return ResearchFindings(summary="s", gaps=[], findings=[
                Finding(claim="good", evidence="e", source_ids=ids, subtask_id="st1", confidence="high"),
                Finding(claim="uncited", evidence="e", source_ids=["S404"], subtask_id="st1", confidence="low"),
            ])
        if schema is ReviewDecision:
            v = self.verdicts.pop(0) if len(self.verdicts) > 1 else self.verdicts[0]
            return ReviewDecision(verdict=v, assessment="x", missing_evidence=["m"] if v == "revise" else [],
                                  unsupported_claims=[], follow_up_queries=["fq"] if v == "revise" else [],
                                  follow_up_target=self.follow_up_target)
        if schema is FinalReport:
            doc = ["Doc fact [D1]"] if re.search(r"^\[D1\]", prompt, re.M) else []
            return FinalReport(title="T", summary="Sum [S1] and fake [S77].",
                               findings=["Fact [S1]", *doc, "Uncited claim", "Fake only [S77]"],
                               analysis=[ReportSection(heading="H", content="Body [S1]")],
                               recommendation="Rec [S2]", limitations=["L"])
        raise AssertionError(schema)


class FakeSearch:
    name = "fake_search"

    def __init__(self, fail_queries=(), fail_all=False):
        self.fail_queries = set(fail_queries)
        self.fail_all = fail_all
        self.queries: list[str] = []

    async def search(self, query, context):
        self.queries.append(query)
        if self.fail_all or query in self.fail_queries:
            raise SearchError("simulated outage")
        return SearchResult(query=query, provider=self.name, summary="digest", executed_queries=[query], sources=[
            SourceDoc(url=f"https://example.org/{query}", title=f"Doc {query}", snippet="snip"),
            SourceDoc(url="https://example.org/shared", title="Shared", snippet="snip"),
        ])


# ---------- Knowledge Library test doubles ----------

import hashlib  # noqa: E402
import math  # noqa: E402
import re  # noqa: E402

from langchain_core.embeddings import Embeddings  # noqa: E402
from qdrant_client import QdrantClient  # noqa: E402


class HashEmbeddings(Embeddings):
    """Deterministic bag-of-words embeddings: lexical overlap -> cosine similarity. No model download."""

    def __init__(self, dim: int = 256, model_id: str = "test/hash-embeddings") -> None:
        self.dim = dim
        self.model_id = model_id
        self.calls = 0

    @property
    def dimension(self) -> int:
        return self.dim

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for tok in re.findall(r"[a-z0-9]+", text.lower()):
            v[int(hashlib.md5(tok.encode()).hexdigest(), 16) % self.dim] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    def embed_documents(self, texts):
        self.calls += 1
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


def make_kb(settings, embedder=None, client=None):
    from rag.knowledge import KnowledgeBase
    from rag.vector_store import VectorIndex
    client = client or QdrantClient(location=":memory:")
    return KnowledgeBase(settings, embedder=embedder or HashEmbeddings(),
                         index_factory=lambda emb: VectorIndex(client, emb, settings.qdrant_collection_prefix))


from contextlib import asynccontextmanager  # noqa: E402


@asynccontextmanager
async def started(app):
    """Run the app's lifespan (schema, workspace, knowledge base) around a test; ASGITransport does not."""
    async with app.router.lifespan_context(app):
        await app.state.kb.wait_ready(10)
        yield app
