"""Cheap live smoke test: one structured Claude call + one real web search.

Usage (from backend/):  .venv/bin/python scripts/check_live.py
Costs a few cents. Verifies your API key, the model id, structured outputs, and that
web search is enabled for your organization.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.llm import ClaudeStructuredLLM  # noqa: E402
from agents.manager import SYSTEM as PLAN_SYSTEM  # noqa: E402
from agents.schemas import ResearchPlan  # noqa: E402
from config import get_settings  # noqa: E402
from tools.web_search import build_search_provider  # noqa: E402


async def main() -> None:
    s = get_settings()
    print(f"model={s.model} search={s.search_provider}/{s.search_tool_version}")
    plan = await ClaudeStructuredLLM(s).generate(
        agent_id="alex", schema=ResearchPlan, system=PLAN_SYSTEM, effort="low",
        prompt="User request:\nCompare PostgreSQL and MongoDB for a social media application.")
    print(f"✓ structured output: {len(plan.subtasks)} subtasks, first query: {plan.subtasks[0].search_queries[0]!r}")
    result = await build_search_provider(s).search(plan.subtasks[0].search_queries[0], plan.objective)
    print(f"✓ web search: {len(result.sources)} sources")
    for src in result.sources[:5]:
        print(f"   - {src.title[:70]}  {src.url}")


if __name__ == "__main__":
    asyncio.run(main())
