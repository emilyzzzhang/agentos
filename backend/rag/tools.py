"""LangChain tool that exposes document retrieval to agents.

The workspace and document scope are bound when the tool is built for a mission; the model
only controls `query` and `top_k`, so it cannot widen its access. The same RetrievalService
can later back an MCP tool without changes.
"""
from __future__ import annotations

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from .retrieval import RetrievalService, RetrievedChunk

TOOL_NAME = "search_documents"


def format_passages(results: list[RetrievedChunk], ids: list[str] | None = None) -> str:
    """LLM-facing text. Passages are wrapped and marked as untrusted data."""
    if not results:
        return "No passages in the selected documents matched this query."
    lines = []
    for i, r in enumerate(results):
        label = ids[i] if ids else f"#{i + 1}"
        lines.append(f"[{label}] {r.reference()} (similarity {r.score})\n<<<PASSAGE\n{r.text}\nPASSAGE>>>")
    return "\n\n".join(lines)


def build_document_search_tool(service: RetrievalService, *, workspace_id: str,
                               document_ids: list[str] | None) -> BaseTool:
    class SearchDocumentsArgs(BaseModel):
        query: str = Field(description="A natural-language question or phrase to look up in the uploaded documents")
        top_k: int = Field(default=service.default_top_k, ge=1, le=service.max_top_k,
                           description="Maximum number of passages to return")

    async def search_documents(query: str, top_k: int = service.default_top_k) -> tuple[str, list[dict]]:
        results = await service.search(query, workspace_id=workspace_id, document_ids=document_ids, top_k=top_k)
        return format_passages(results), [r.model_dump() for r in results]

    return StructuredTool.from_function(
        coroutine=search_documents, name=TOOL_NAME, args_schema=SearchDocumentsArgs,
        response_format="content_and_artifact",
        description=("Semantic search over the user's uploaded documents (Knowledge Library). "
                     "Returns relevant passages with file name, page or section, and a similarity score."),
    )
