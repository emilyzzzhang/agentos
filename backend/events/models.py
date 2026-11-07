from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class EventType(str, Enum):
    RUN_STARTED = "run.started"
    TASK_ASSIGNED = "task.assigned"
    AGENT_STARTED = "agent.started"
    AGENT_COMPLETED = "agent.completed"
    AGENT_FAILED = "agent.failed"
    TOOL_STARTED = "tool.started"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"
    REVIEW_REQUESTED = "review.requested"
    REPORT_GENERATED = "report.generated"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"
    # Knowledge Library retrieval inside a mission (agent_id="milo").
    RAG_RETRIEVAL_STARTED = "rag.retrieval_started"
    RAG_RETRIEVAL_COMPLETED = "rag.retrieval_completed"
    RAG_RETRIEVAL_FAILED = "rag.retrieval_failed"
    # Workspace-level document lifecycle (run_id is null; streamed on /documents/events).
    DOCUMENT_UPLOADED = "document.uploaded"
    DOCUMENT_INDEXING_STARTED = "document.indexing_started"
    DOCUMENT_INDEXING_COMPLETED = "document.indexing_completed"
    DOCUMENT_INDEXING_FAILED = "document.indexing_failed"
    DOCUMENT_DELETED = "document.deleted"


TERMINAL_EVENTS = {EventType.RUN_COMPLETED, EventType.RUN_FAILED}


class ExecutionEvent(BaseModel):
    id: str = Field(default_factory=lambda: f"evt_{uuid4().hex}")
    run_id: str | None  # null for workspace-level document events
    seq: int
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    type: EventType
    agent_id: str | None = None
    task_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

    def to_json(self) -> str:
        return self.model_dump_json()
