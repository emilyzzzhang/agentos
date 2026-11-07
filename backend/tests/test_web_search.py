import pytest

from config import Settings
from tools.web_search import AnthropicWebSearch, SearchError


@pytest.fixture
def ws():
    return AnthropicWebSearch(Settings(anthropic_api_key="sk-test"))


def test_parse_results_and_citations(ws):
    blocks = [
        {"type": "server_tool_use", "name": "web_search", "input": {"query": "postgres vs mongo 2026"}},
        {"type": "web_search_tool_result", "content": [
            {"type": "web_search_result", "url": "https://a.example/pg", "title": "PG", "page_age": "2026-01-01", "encrypted_content": "x"},
            {"type": "web_search_result", "url": "https://b.example/mongo", "title": "Mongo", "encrypted_content": "y"},
        ]},
        {"type": "text", "text": "Postgres is relational. ", "citations": [
            {"type": "web_search_result_location", "url": "https://a.example/pg", "title": "PG", "cited_text": "PostgreSQL is a relational DB"},
            {"type": "web_search_result_location", "url": "https://c.example/only-cited", "title": "C", "cited_text": "extra"},
        ]},
        {"type": "text", "text": "Mongo is a document store.", "citations": None},
    ]
    r = ws._parse("q", blocks)
    urls = [s.url for s in r.sources]
    assert urls == ["https://a.example/pg", "https://b.example/mongo", "https://c.example/only-cited"]
    assert r.sources[0].snippet == "PostgreSQL is a relational DB"
    assert r.executed_queries == ["postgres vs mongo 2026"]
    assert r.summary.startswith("Postgres is relational.")


def test_parse_error_object_raises(ws):
    blocks = [{"type": "web_search_tool_result", "content": {"type": "web_search_tool_result_error", "error_code": "max_uses_exceeded"}}]
    with pytest.raises(SearchError, match="max_uses_exceeded"):
        ws._parse("q", blocks)


async def test_falls_back_to_basic_tool_when_no_sources(ws, monkeypatch):
    calls = []

    async def fake_search(query, context):
        calls.append(ws.tool_version)
        if ws.tool_version != ws.BASIC_TOOL:
            raise SearchError("web search returned no sources")
        return ws._parse(query, [{"type": "web_search_tool_result", "content": [{"url": "https://x.example", "title": "X"}]}])

    monkeypatch.setattr(ws, "_search", fake_search)
    r = await ws.search("q", "ctx")
    assert calls == ["web_search_20260209", "web_search_20250305"] and r.sources[0].url == "https://x.example"
