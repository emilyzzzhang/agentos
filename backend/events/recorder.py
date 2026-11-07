"""Per-run event log: assigns sequence numbers, persists JSONL, fans out to subscribers.

All mutation happens on the asyncio event loop that runs the workflow, so no locks
are needed beyond the asyncio.Condition used to wake SSE subscribers.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

from .models import TERMINAL_EVENTS, EventType, ExecutionEvent

log = logging.getLogger(__name__)
EventSink = Callable[[ExecutionEvent], Awaitable[None]]


class EventRecorder:
    def __init__(self, run_id: str, jsonl_path: Path | None = None, sink: EventSink | None = None) -> None:
        self.run_id = run_id
        self._sink = sink  # e.g. PostgreSQL persistence; failures are logged, never fatal to the run
        self.events: list[ExecutionEvent] = []
        self._jsonl_path = jsonl_path
        self._cond = asyncio.Condition()
        self.closed = False
        if jsonl_path is not None:
            jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            jsonl_path.write_text("")

    @property
    def last_seq(self) -> int:
        return self.events[-1].seq if self.events else 0

    async def emit(
        self,
        type: EventType,
        *,
        agent_id: str | None = None,
        task_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> ExecutionEvent:
        if self.closed:
            raise RuntimeError(f"run {self.run_id} event log already closed")
        event = ExecutionEvent(
            run_id=self.run_id,
            seq=self.last_seq + 1,
            type=type,
            agent_id=agent_id,
            task_id=task_id,
            payload=payload or {},
        )
        self.events.append(event)
        if self._jsonl_path is not None:
            with self._jsonl_path.open("a", encoding="utf-8") as fh:
                fh.write(event.to_json() + "\n")
        if self._sink is not None:
            try:
                await self._sink(event)
            except Exception:
                log.exception("could not persist event %s #%s (JSONL copy kept)", self.run_id, event.seq)
        if type in TERMINAL_EVENTS:
            self.closed = True
        async with self._cond:
            self._cond.notify_all()
        return event

    def since(self, after_seq: int) -> list[ExecutionEvent]:
        return [e for e in self.events if e.seq > after_seq]

    async def subscribe(self, after_seq: int = 0, heartbeat_s: float = 15.0) -> AsyncIterator[ExecutionEvent | None]:
        """Yield events with seq > after_seq; yields None as a heartbeat tick.

        Ends after the terminal event has been delivered.
        """
        cursor = after_seq
        while True:
            pending = self.since(cursor)
            for event in pending:
                cursor = event.seq
                yield event
            if self.closed and not self.since(cursor):
                return
            timed_out = False
            async with self._cond:
                if not self.since(cursor) and not self.closed:
                    try:
                        await asyncio.wait_for(self._cond.wait(), timeout=heartbeat_s)
                    except asyncio.TimeoutError:
                        timed_out = True
            if timed_out:  # yield outside the lock so emit() is never blocked
                yield None
