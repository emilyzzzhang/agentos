"""Real web search for Milo.

Providers:
  * AnthropicWebSearch - Claude's server-side `web_search` tool (same ANTHROPIC_API_KEY).
    Sources come from the `web_search_tool_result` blocks the API returns and from
    `web_search_result_location` citations on the text, never from model free text.
  * TavilySearch - Tavily REST API (requires TAVILY_API_KEY).
"""
from __future__ import annotations

import logging
from typing import Any, Protocol

import anthropic
import httpx
from pydantic import BaseModel

from config import Settings

log = logging.getLogger(__name__)


class SearchError(RuntimeError):
    pass


class SourceDoc(BaseModel):
    url: str
    title: str = ""
    snippet: str = ""
    page_age: str | None = None


class SearchResult(BaseModel):
    query: str
    provider: str
    sources: list[SourceDoc]
    summary: str = ""
    executed_queries: list[str] = []


class SearchProvider(Protocol):
    name: str

    async def search(self, query: str, context: str) -> SearchResult: ...


def _as_dict(block: Any) -> dict:
    if isinstance(block, dict):
        return block
    if hasattr(block, "model_dump"):
        return block.model_dump()
    return dict(block.__dict__)


class AnthropicWebSearch:
    name = "anthropic_web_search"
    FALLBACK_BETA = "server-side-fallback-2026-07-01"
    BASIC_TOOL = "web_search_20250305"

    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise SearchError("ANTHROPIC_API_KEY is not set")
        self.settings = settings
        self.client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key, timeout=settings.llm_timeout_s, max_retries=2
        )
        self._use_fallback = settings.refusal_fallback
        self.tool_version = settings.search_tool_version

    async def _create(self, messages: list[dict]) -> Any:
        params: dict[str, Any] = dict(
            model=self.settings.search_model,
            max_tokens=8000,
            system=(
                "You are a web research assistant. Always use the web_search tool before answering. "
                "Then write a concise, factual digest (under 220 words) of what the sources say, "
                "citing them. Do not add facts that are not in the search results."
            ),
            messages=messages,
            tools=[{
                "type": self.tool_version,
                "name": "web_search",
                "max_uses": self.settings.search_max_uses,
            }],
            output_config={"effort": self.settings.effort_researcher},
        )
        if self._use_fallback:
            try:
                return await self.client.beta.messages.create(
                    **params, betas=[self.FALLBACK_BETA], fallbacks="default"
                )
            except anthropic.BadRequestError as exc:
                if "fallback" not in str(exc).lower():
                    raise
                log.warning("Refusal fallback rejected (%s); continuing without it.", exc)
                self._use_fallback = False
        return await self.client.beta.messages.create(**params)

    async def search(self, query: str, context: str) -> SearchResult:
        try:
            return await self._search(query, context)
        except SearchError as exc:
            # If the dynamic-filtering tool version yields nothing parseable, fall back to the
            # basic web search tool once and keep using it for the rest of the process.
            if self.tool_version == self.BASIC_TOOL or "no sources" not in str(exc):
                raise
            log.warning("%s returned no sources (%s); retrying with %s", self.tool_version, exc, self.BASIC_TOOL)
            self.tool_version = self.BASIC_TOOL
            return await self._search(query, context)

    async def _search(self, query: str, context: str) -> SearchResult:
        messages: list[dict] = [{
            "role": "user",
            "content": f"Research context: {context}\n\nSearch the web for: {query}",
        }]
        blocks: list[dict] = []
        try:
            for _ in range(4):  # resume pause_turn a bounded number of times
                resp = await self._create(messages)
                content = [_as_dict(b) for b in resp.content]
                blocks.extend(content)
                if resp.stop_reason == "refusal":
                    raise SearchError("search request was declined (refusal)")
                if resp.stop_reason != "pause_turn":
                    break
                messages = messages[:1] + [{"role": "assistant", "content": resp.content}]
        except anthropic.APIConnectionError as exc:
            raise SearchError(f"network error contacting Anthropic: {exc}") from exc
        except anthropic.RateLimitError as exc:
            raise SearchError(f"rate limited: {exc}") from exc
        except anthropic.APIStatusError as exc:
            raise SearchError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        return self._parse(query, blocks)

    def _parse(self, query: str, blocks: list[dict]) -> SearchResult:
        sources: dict[str, SourceDoc] = {}
        executed: list[str] = []
        errors: list[str] = []
        texts: list[str] = []
        for b in blocks:
            btype = b.get("type")
            if btype == "server_tool_use" and b.get("name") == "web_search":
                q = (b.get("input") or {}).get("query")
                if q:
                    executed.append(q)
            elif btype == "web_search_tool_result":
                content = b.get("content")
                if isinstance(content, list):
                    for r in content:
                        url = r.get("url")
                        if url and url not in sources:
                            sources[url] = SourceDoc(url=url, title=r.get("title") or "", page_age=r.get("page_age"))
                elif isinstance(content, dict) and content.get("error_code"):
                    errors.append(content["error_code"])
            elif btype == "text":
                texts.append(b.get("text") or "")
                for c in b.get("citations") or []:
                    url = c.get("url")
                    if not url:
                        continue
                    doc = sources.get(url) or SourceDoc(url=url, title=c.get("title") or "")
                    cited = (c.get("cited_text") or "").strip()
                    if cited and cited not in doc.snippet:
                        doc.snippet = (doc.snippet + " … " + cited).strip(" …") if doc.snippet else cited
                    sources[url] = doc
        if not sources:
            detail = f" (errors: {', '.join(errors)})" if errors else ""
            raise SearchError(f"web search returned no sources{detail}")
        return SearchResult(
            query=query, provider=self.name, sources=list(sources.values()),
            summary="".join(texts).strip(), executed_queries=executed or [query],
        )


class TavilySearch:
    name = "tavily"

    def __init__(self, settings: Settings) -> None:
        if not settings.tavily_api_key:
            raise SearchError("TAVILY_API_KEY is not set")
        self.key = settings.tavily_api_key

    async def search(self, query: str, context: str) -> SearchResult:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post("https://api.tavily.com/search", json={
                    "api_key": self.key, "query": query, "max_results": 5,
                    "include_answer": True, "search_depth": "basic",
                })
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPError as exc:
            raise SearchError(f"Tavily request failed: {exc}") from exc
        sources = [
            SourceDoc(url=x["url"], title=x.get("title") or "", snippet=(x.get("content") or "")[:600])
            for x in data.get("results", []) if x.get("url")
        ]
        if not sources:
            raise SearchError("Tavily returned no results")
        return SearchResult(query=query, provider=self.name, sources=sources,
                            summary=data.get("answer") or "", executed_queries=[query])


def build_search_provider(settings: Settings) -> SearchProvider:
    if settings.search_provider == "tavily":
        return TavilySearch(settings)
    return AnthropicWebSearch(settings)
