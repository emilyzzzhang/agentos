"""Structured outputs produced by the agents.

Schemas avoid numeric/length constraints so they stay compatible with Claude's
native structured outputs (output_config.format json_schema).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------- Alex (Manager) ----------
class Subtask(BaseModel):
    id: str = Field(description="Short slug id, e.g. 'st1'")
    title: str = Field(description="Short imperative title, under 8 words")
    description: str = Field(description="What Milo must find out for this subtask")
    search_queries: list[str] = Field(description="1-2 concrete queries (web search queries, or natural-language questions for document search)")
    evidence_source: Literal["web", "documents", "both"] = Field(
        default="web", description="Where the evidence should come from: public web, the uploaded documents, or both")


TaskType = Literal["comparison", "study_plan", "research", "how_to", "explanation", "summary"]


class ResearchPlan(BaseModel):
    objective: str = Field(description="One-sentence restatement of the user's goal")
    approach: str = Field(description="2-3 sentence summary of how the team will answer it")
    subtasks: list[Subtask] = Field(description="2-4 research subtasks")
    success_criteria: list[str] = Field(description="What a complete answer must contain")
    task_type: TaskType = Field(default="research", description=(
        "comparison: choose between options; study_plan: a learning or preparation schedule; "
        "how_to: steps to do something; explanation: how or why something works; "
        "summary: summarize the user's uploaded documents; research: any other evidence-based question"))
    assumptions: list[str] = Field(default_factory=list, description=(
        "Assumptions made because the request omits an essential detail (role, deadline, level, scale, version). "
        "Empty if nothing essential is missing"))
    clarifying_questions: list[str] = Field(default_factory=list, description=(
        "At most 2 focused questions whose answers would change the result. Empty if none"))


# ---------- Milo (Researcher) ----------
class Finding(BaseModel):
    claim: str = Field(description="A specific factual finding")
    evidence: str = Field(description="Short supporting detail drawn from the sources")
    source_ids: list[str] = Field(description="IDs of the supporting sources: 'S3' for a web source, 'D2' for an uploaded-document passage")
    subtask_id: str = Field(description="Which subtask this finding answers")
    confidence: Literal["high", "medium", "low"]


class ResearchFindings(BaseModel):
    summary: str = Field(description="2-3 sentence summary of what was learned this pass")
    findings: list[Finding]
    gaps: list[str] = Field(description="Questions the sources did not answer")


# ---------- Luna (Reviewer) ----------
class ReviewDecision(BaseModel):
    verdict: Literal["approve", "revise"]
    assessment: str = Field(description="2-4 sentence assessment of research quality")
    missing_evidence: list[str] = Field(description="Specific evidence still missing (empty if approved)")
    unsupported_claims: list[str] = Field(description="Claims that lack adequate source support")
    follow_up_queries: list[str] = Field(description="Search queries for Milo if verdict is revise")
    follow_up_target: Literal["web", "documents", "both"] = Field(
        default="web", description="Where Milo should run the follow-up queries")


class ReportSection(BaseModel):
    heading: str = Field(description="Plain descriptive heading, e.g. 'Write throughput' or 'Operational cost'")
    content: str = Field(description="Markdown body. Explain the trade-off. Cite factual claims inline with [S1], [D2] or [S2][D4].")


class TradeoffRow(BaseModel):
    criterion: str = Field(description="What is compared, e.g. 'Write throughput'")
    values: list[str] = Field(description="One short value per option, in the same order as `options` (max ~12 words each)")


class PlanTask(BaseModel):
    task: str = Field(description="A concrete action, e.g. 'Solve 3 medium sliding-window problems in 45 minutes each'")
    priority: Literal["high", "medium", "low"]


class PlanPhase(BaseModel):
    period: str = Field(description="Time box or step label, e.g. 'Week 1', 'Days 1-3', 'Step 2'")
    focus: str = Field(description="What this phase is for, in a few words")
    tasks: list[PlanTask] = Field(description="2-5 actionable tasks")
    time: str = Field(default="", description="study_plan: time budget for the phase, e.g. '2 h/day'. Empty if unknown")


class ChooseIf(BaseModel):
    option: str = Field(description="One of the compared options")
    when: str = Field(description="The conditions under which this option is the better choice, in one sentence")


class FinalReport(BaseModel):
    report_type: TaskType = Field(default="research", description="Same task type as the plan unless the evidence shows otherwise")
    title: str = Field(description="Plain descriptive title. No colon-subtitles, no adjectives such as 'ultimate' or 'definitive'")
    summary: str = Field(description=(
        "THE ANSWER, shown first: 1-3 short sentences that directly answer the request (the recommendation, the "
        "plan in one line, or the explanation in one line). The reader must be able to stop here. At most one citation group"))
    key_points: list[str] = Field(default_factory=list, description=(
        "3-5 short bullets shown right after the answer. research: key findings; explanation: key ideas; "
        "summary: main takeaways; study_plan: topics to cover; how_to: what to know first. comparison: leave empty"))
    findings: list[str] = Field(description=(
        "Supporting evidence, shown in a collapsible Evidence section: at most 6 verified facts, one sentence each, "
        "each citing its one or two strongest sources [S#] or [D#]. Do not repeat the answer or key points word for word"))
    analysis: list[ReportSection] = Field(description=(
        "Short sections. explanation/summary/research: the main body (2-4 sections). comparison: 0-2 deeper notes "
        "(collapsible). study_plan/how_to: at most 1 ('Why this order'). Never repeat other parts"))
    recommendation: str = Field(description=(
        "research: only if the user asked for advice, otherwise empty. study_plan/how_to: optional one-paragraph advice. "
        "comparison/explanation/summary: leave empty (the answer and choose_if cover it)"))
    limitations: list[str] = Field(description="At most 3: missing evidence, weak or old sources, open questions. No citations")
    assumptions: list[str] = Field(default_factory=list, description="Assumptions the answer depends on (from the plan, refined if needed)")
    options: list[str] = Field(default_factory=list, description="comparison only: the 2-4 options being compared")
    tradeoffs: list[TradeoffRow] = Field(default_factory=list, description="comparison only: 4-7 deciding criteria")
    choose_if: list[ChooseIf] = Field(default_factory=list, description="comparison only: when to choose each option")
    plan: list[PlanPhase] = Field(default_factory=list, description="study_plan and how_to only: ordered phases or steps")
    example: str = Field(default="", description=(
        "explanation (optional for how_to): one short worked example in Markdown, e.g. a small code block or a "
        "concrete scenario with numbers. Empty if an example would not help"))
    diagram_title: str = Field(default="", description="explanation only: title of the flow diagram, e.g. 'How a request is handled'")
    diagram_steps: list[str] = Field(default_factory=list, description=(
        "explanation only: 3-7 short labels (2-6 words each) for a left-to-right flow diagram of the process. "
        "Empty if the topic is not a process or flow"))
