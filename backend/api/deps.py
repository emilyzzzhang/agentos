"""Request-scoped dependencies."""
from __future__ import annotations

from fastapi import Request


def workspace(request: Request) -> str:
    """The workspace every query is filtered by.

    There is no authentication yet, so this is the single configured local workspace
    (AGENTOS_WORKSPACE_ID). When accounts exist, derive it from the authenticated user here;
    it must never come from a client-supplied header or parameter.
    """
    return request.app.state.settings.workspace_id
