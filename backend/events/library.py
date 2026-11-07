"""Workspace-level live events for the Knowledge Library (document.* types).

Same `ExecutionEvent` schema as run events, with `run_id=None`. Kept in memory with a short
replay buffer: these are notifications only. The documents table is the source of truth, so a
client that reconnects after a server restart re-fetches GET /documents.
"""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any, AsyncIterator

from .models import EventType, ExecutionEvent


class LibraryEventBus:
    def __init__(self, buffer: int = 500) -> None:
        self._buffer = buffer
        self._events: dict[str, deque[ExecutionEvent]] = {}
        self._seq: dict[str, int] = {}
        self._cond = asyncio.Condition()

    def last_seq(self, workspace_id: str) -> int:
        return self._seq.get(workspace_id, 0)

    async def emit(self, workspace_id: str, type: EventType, payload: dict[str, Any]) -> ExecutionEvent:
        seq = self._seq.get(workspace_id, 0) + 1
        self._seq[workspace_id] = seq
        event = ExecutionEvent(run_id=None, seq=seq, type=type, payload={"workspace_id": workspace_id, **payload})
        self._events.setdefault(workspace_id, deque(maxlen=self._buffer)).append(event)
        async with self._cond:
            self._cond.notify_all()
        return event

    def since(self, workspace_id: str, after: int) -> list[ExecutionEvent]:
        return [e for e in self._events.get(workspace_id, ()) if e.seq > after]

    async def subscribe(self, workspace_id: str, after: int = 0, heartbeat_s: float = 15.0) -> AsyncIterator[ExecutionEvent | None]:
        cursor = min(after, self.last_seq(workspace_id))  # a seq from before a restart replays the buffer
        while True:
            for e in self.since(workspace_id, cursor):
                cursor = e.seq
                yield e
            timed_out = False
            async with self._cond:
                if not self.since(workspace_id, cursor):
                    try:
                        await asyncio.wait_for(self._cond.wait(), timeout=heartbeat_s)
                    except asyncio.TimeoutError:
                        timed_out = True
            if timed_out:
                yield None
