from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


def merge_dicts(a: dict, b: dict) -> dict:
    return {**(a or {}), **(b or {})}


class OfficeState(TypedDict, total=False):
    run_id: str
    question: str
    plan: dict[str, Any]
    sources: Annotated[dict[str, dict], merge_dicts]
    findings: Annotated[list[dict], operator.add]
    reviews: Annotated[list[dict], operator.add]
    revision_count: int
    pending_queries: list[str]
    follow_up_target: str  # web | documents | both
    review_notes: list[str]
    send_back: bool
    report: dict[str, Any]
    report_markdown: str
    report_path: str
    cited_sources: list[str]
