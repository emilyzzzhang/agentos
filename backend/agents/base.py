from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from config import Settings
from events import EventRecorder
from tools.web_search import SearchProvider

from .llm import StructuredLLM

AGENTS = {
    "alex": {"name": "Alex", "role": "Manager"},
    "milo": {"name": "Milo", "role": "Researcher"},
    "luna": {"name": "Luna", "role": "Reviewer"},
}


class WorkflowError(RuntimeError):
    """A failure that has already been reported via an agent.failed event."""

    def __init__(self, agent_id: str, message: str) -> None:
        super().__init__(f"{agent_id}: {message}")
        self.agent_id = agent_id
        self.message = message


@dataclass
class KnowledgeScope:
    """Uploaded documents a mission may search. Built server-side per mission."""
    workspace_id: str
    documents: list[dict[str, Any]]   # {id, title, filename, file_type, page_count, chunk_count}
    explicit: bool                    # True if the user selected these documents for the mission
    tool: Any                         # LangChain BaseTool bound to this workspace + document scope

    @property
    def document_ids(self) -> list[str]:
        return [d["id"] for d in self.documents]


@dataclass
class AgentContext:
    run_id: str
    settings: Settings
    llm: StructuredLLM
    search: SearchProvider
    events: EventRecorder
    knowledge: KnowledgeScope | None = None
    # Every source gathered so far, by citation ID (S# web, D# document). Server-side only: it
    # holds passage text and is persisted as mission evidence even if the run fails.
    evidence: dict[str, dict[str, Any]] = field(default_factory=dict)
