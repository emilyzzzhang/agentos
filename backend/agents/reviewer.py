"""Luna - Reviewer: checks evidence quality, requests follow-up research, writes the report."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from events import EventType

from .base import AgentContext, WorkflowError
from .schemas import FinalReport, ResearchPlan, ReviewDecision
from .sources import label as source_type_label

REVIEW_SYSTEM = """You are Luna, a rigorous research reviewer.
Decide whether the findings are sufficient to answer the user's request and meet every success criterion.
- verdict "approve" if the evidence is adequate for a well-supported recommendation.
- verdict "revise" only if specific, important evidence is missing; then give 1-3 targeted web search queries.
- Flag claims whose cited sources look weak, outdated, or off-topic.
Do not request more research for minor polish."""

REVIEW_DOCUMENT_RULES = """
Evidence comes from two kinds of sources. Keep them apart:
- D# IDs are passages from the user's uploaded documents. They show what the documents state.
- S# IDs are public web sources. They show external information.
- If the user asked about their documents, a claim about the documents must cite a D# passage. A web source
  cannot confirm what the documents say.
- Flag contradictions between documents and web sources, and between documents.
- If you request more research, set follow_up_target: "documents" to search the uploaded documents again
  with new questions, "web" for web search, or "both"."""

REPORT_DOCUMENT_RULES = """
Document evidence:
- Cite uploaded-document passages with their D IDs, for example [D2], and web sources with S IDs.
- The renderer adds the file name and page or section for every D citation. Do not write page numbers or file
  names as a substitute for a citation.
- Make clear which statements come from the user's documents and which come from external sources.
- If documents and web sources disagree, state both versions and record the conflict in limitations.
- If the documents do not contain the answer, say so. Do not fill the gap with assumptions."""

REPORT_SYSTEM = """You are Luna, writing the team's final answer for the user.
The reader wants the answer quickly and the details only when they need them. Write a useful answer, not a
research paper and not a record of how the team worked.

Answer first:
- `summary` is the answer: 1-3 short sentences that directly answer the request (the choice, the plan in one
  line, the explanation in one line). The reader must be able to stop there.
- Then give only what helps the reader act or understand. No introduction, no restating the question, no recap.

Structure by report_type (use the task type given in the prompt unless the evidence clearly shows otherwise):
- comparison: `summary` names the choice. `options` = the 2-4 options. `tradeoffs` = 4-7 deciding criteria, each value
  a short phrase. `choose_if` = one line per option: when it is the better choice. `analysis` = 0-2 deeper notes,
  only for points the table cannot hold. Leave `key_points` and `recommendation` empty.
- study_plan: `key_points` = the 3-6 topics to cover. `plan` = 3-8 phases with a time box (e.g. "Week 1"), a focus,
  a `time` budget if known, and 2-5 concrete tasks each (actions with an amount, not topics), each with a priority.
  `analysis` = at most 1 short section titled "Why this order".
- how_to: `key_points` = what to know or have before starting. `plan` = ordered steps ("Step 1", ...), each with
  concrete tasks. Add an `example` if it helps.
- explanation: `key_points` = 3-5 key ideas. `analysis` = 2-4 short sections that explain the parts, each with a
  plain heading. `diagram_steps` = 3-7 short labels if the topic is a process or flow (for example the path of a
  request), else empty. `example` = one small worked example (a short code block or a concrete scenario).
- research: `key_points` = the 3-5 key findings. `analysis` = 1-3 short sections where context is needed.
  `recommendation` only if the user asked for advice.
- summary (of uploaded documents): `key_points` = the main takeaways. `analysis` = relevant details by topic.
- In every type, `findings` holds the supporting evidence (at most 6). It is shown in a collapsible Evidence
  section, so it must not repeat the answer or the key points word for word.

Evidence and citations:
- Use ONLY the provided findings and sources. Never invent facts, numbers, dates, versions, names or sources.
- Cite sparingly. Cite a specific fact, number or version, not general statements, your own analysis, advice,
  plan tasks, or common knowledge.
- At most one citation group per sentence, bullet or table cell, with the one or two strongest sources: [S2] or
  [S2][S5]. When one source supports a whole paragraph, cite it once at the end.
- The answer needs at most one citation group. Limitations need none.
- Prefer official docs, standards/specs and papers over blogs and forums (sources are labeled by type).
- Never cite a source ID that is not in the source list.
- If evidence is weak, old or missing, say so briefly in `limitations` (at most 3).

Writing:
- Plain, natural, direct language. Short sentences, active voice. Precise technical terms with numbers, versions
  and conditions instead of vague words. Keep the important technical details.
- Paragraphs of 1-3 sentences. Bullets of one sentence. Use tables and lists only where they make the content
  easier to scan.
- Headings say what the section is about ("Write throughput", "How the GIL is removed"), never generic labels
  such as "Verified findings", "Analysis", "Overview" or "Conclusion".
- No filler or marketing language: no "in today's rapidly evolving landscape", "it's important to note",
  "game-changing", "seamless", "leverage", "delve", "in conclusion". No section that repeats another.

Assumptions:
- Copy the plan's assumptions into `assumptions` and add any you had to make. Never present an assumption as a fact.
- If the plan has clarifying questions, the answer must still be useful under the stated assumptions."""


class Reviewer:
    agent_id = "luna"

    def __init__(self, ctx: AgentContext) -> None:
        self.ctx = ctx

    async def review(self, *, question: str, plan: ResearchPlan, findings: list[dict], sources: dict[str, dict],
                     revision_count: int) -> tuple[ReviewDecision, bool]:
        """Returns (decision, send_back_for_more_research)."""
        ev = self.ctx.events
        n = revision_count + 1
        task_id = f"review-{n}"
        max_rev = self.ctx.settings.max_revisions
        await ev.emit(EventType.AGENT_STARTED, agent_id="luna", task_id=task_id, payload={
            "action": "review", "summary": f"Reviewing {len(findings)} findings", "iteration": revision_count})
        has_docs = self.ctx.knowledge is not None
        try:
            decision = await self.ctx.llm.generate(
                agent_id="luna", schema=ReviewDecision, system=REVIEW_SYSTEM + (REVIEW_DOCUMENT_RULES if has_docs else ""),
                prompt=(f"User request: {question}\n\nSuccess criteria:\n"
                        + "\n".join(f"- {c}" for c in plan.success_criteria)
                        + f"\n\nFindings:\n{format_findings(findings, sources)}"
                        + f"\n\nAdditional research rounds remaining: {max_rev - revision_count}"),
                effort=self.ctx.settings.effort_reviewer,
            )
        except Exception as exc:
            await ev.emit(EventType.AGENT_FAILED, agent_id="luna", task_id=task_id, payload={"error": str(exc)})
            raise WorkflowError("luna", str(exc)) from exc

        queries = [q.strip() for q in decision.follow_up_queries if q.strip()][: self.ctx.settings.max_queries_followup]
        target = decision.follow_up_target if has_docs else "web"
        wants_more = decision.verdict == "revise"
        send_back = wants_more and bool(queries) and revision_count < max_rev
        limit_reached = wants_more and not send_back
        await ev.emit(EventType.AGENT_COMPLETED, agent_id="luna", task_id=task_id, payload={
            "action": "review", "verdict": decision.verdict, "assessment": decision.assessment,
            "missing_evidence": decision.missing_evidence, "unsupported_claims": decision.unsupported_claims,
            "summary": ("Approved the research" if not wants_more else
                        "Requested additional research" if send_back else
                        "Revision limit reached; proceeding with caveats"),
            "revision_limit_reached": limit_reached,
        })
        if send_back:
            next_task = f"research-{n + 1}"
            await ev.emit(EventType.REVIEW_REQUESTED, agent_id="luna", task_id=next_task, payload={
                "from_agent": "luna", "to_agent": "milo", "iteration": n,
                "missing_evidence": decision.missing_evidence, "follow_up_queries": queries,
                "follow_up_target": target})
            await ev.emit(EventType.TASK_ASSIGNED, agent_id="luna", task_id=next_task, payload={
                "from_agent": "luna", "to_agent": "milo", "title": f"Follow-up research (round {n})",
                "description": "; ".join(decision.missing_evidence) or "Strengthen evidence",
                "search_queries": queries, "evidence_source": target})
        return decision.model_copy(update={"follow_up_queries": queries, "follow_up_target": target}), send_back

    async def write_report(self, *, question: str, plan: ResearchPlan, findings: list[dict],
                           sources: dict[str, dict], reviews: list[dict], revision_count: int) -> tuple[FinalReport, str, list[str]]:
        ev = self.ctx.events
        await ev.emit(EventType.AGENT_STARTED, agent_id="luna", task_id="report",
                      payload={"action": "write_report", "summary": "Writing the final report"})
        open_issues = reviews[-1].get("missing_evidence", []) if reviews and reviews[-1].get("verdict") == "revise" else []
        try:
            has_docs = any(v.get("kind") == "document" for v in sources.values())
            context = (f"Task type: {plan.task_type}\n"
                       + ("Assumptions from the plan:\n" + "\n".join(f"- {a}" for a in plan.assumptions) + "\n" if plan.assumptions else "")
                       + ("Open clarifying questions:\n" + "\n".join(f"- {q}" for q in plan.clarifying_questions) + "\n" if plan.clarifying_questions else ""))
            report = await self.ctx.llm.generate(
                agent_id="luna", schema=FinalReport, system=REPORT_SYSTEM + (REPORT_DOCUMENT_RULES if has_docs else ""),
                prompt=(f"User request: {question}\n\nObjective: {plan.objective}\n{context}\n"
                        f"Findings:\n{format_findings(findings, sources)}\n\n"
                        f"Source list:\n" + "\n".join(f"[{k}] {source_label(v)}" for k, v in sources.items())
                        + ("\n\nUnresolved reviewer concerns (state these in limitations):\n"
                           + "\n".join(f"- {x}" for x in open_issues) if open_issues else "")),
                effort=self.ctx.settings.effort_reviewer,
            )
        except Exception as exc:
            await ev.emit(EventType.AGENT_FAILED, agent_id="luna", task_id="report", payload={"error": str(exc)})
            raise WorkflowError("luna", str(exc)) from exc
        if not report.assumptions and plan.assumptions:
            report = report.model_copy(update={"assumptions": plan.assumptions})
        markdown, cited = render_report(report, sources, question=question, revision_count=revision_count,
                                        model=self.ctx.settings.model, clarifying_questions=plan.clarifying_questions)
        return report, markdown, cited


def location(src: dict) -> str:
    """Human page/section reference for a document passage, e.g. 'p. 4' or 'section "Limits > Batch size"'."""
    if src.get("page"):
        return f"p. {src['page']}"
    if src.get("section"):
        return f'section "{src["section"]}"'
    return ""


def source_label(src: dict) -> str:
    if src.get("kind") == "document":
        loc = location(src)
        return f"uploaded document: {src.get('filename') or src['title']}{', ' + loc if loc else ''}"
    return f"web ({source_type_label(src['url'])}): {src['title']} - {src['url']}"


def format_findings(findings: list[dict], sources: dict[str, dict]) -> str:
    if not findings:
        return "(no findings)"
    lines = []
    for f in findings:
        refs = ", ".join(
            f"{i} ({'document: ' + (sources[i].get('filename') or '') + (', ' + location(sources[i]) if location(sources[i]) else '') if sources[i].get('kind') == 'document' else sources[i]['title'][:60]})"
            for i in f["source_ids"] if i in sources)
        lines.append(f"- [{f['confidence']}] {f['claim']} — {f['evidence']} (sources: {refs})")
    return "\n".join(lines)


_CITE = re.compile(r"\[([SD]\d+)\]")


def citation_href(sid: str, src: dict) -> str:
    """Web citations link to the URL; document citations link to the in-app evidence viewer."""
    return f"#evidence-{sid}" if src.get("kind") == "document" else src["url"]


_DUP_CITES = re.compile(r"(\[[SD]\d+\])(?:\s*\1)+")
PRIORITY = {"high": "High", "medium": "Medium", "low": "Low"}
TYPE_LABEL = {"comparison": "Comparison", "study_plan": "Study plan", "research": "Research", "how_to": "How-to",
              "explanation": "Explanation", "summary": "Document summary"}
KEY_POINTS_HEADING = {"research": "Key findings", "explanation": "Key ideas", "summary": "Main takeaways",
                      "study_plan": "Topics to cover", "how_to": "Before you start"}


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


_GROUP = re.compile(r"(?:\[[SD]\d+\]\s*)+")


def cite_once_per_paragraph(text: str) -> str:
    """Within a paragraph, drop a citation group when the next group is identical.

    "A [S1]. B [S1]. C [S1]." becomes "A. B. C [S1]." Code blocks are left as is.
    """
    def paragraph(block: str) -> str:
        groups = list(_GROUP.finditer(block))
        keys = [tuple(sorted(set(_CITE.findall(g.group(0))))) for g in groups]
        for i in reversed(range(len(groups) - 1)):
            if keys[i] == keys[i + 1]:
                g = groups[i]
                trail = " " if g.group(0)[-1:] in (" ", "\t") and block[g.end():g.end() + 1] not in ".,;:" else ""
                block = block[:g.start()].rstrip(" \t") + trail + block[g.end():]
        return block

    # fenced code blocks (odd indexes after the split) are kept verbatim
    pieces = re.split(r"(```.*?```)", text or "", flags=re.S)
    return "".join(piece if i % 2 else "".join(paragraph(b) if j % 2 == 0 else b
                                                for j, b in enumerate(re.split(r"(\n\s*\n)", piece)))
                   for i, piece in enumerate(pieces))


def _mermaid_label(text: str) -> str:
    return " ".join(text.replace('"', "'").replace("[", "(").replace("]", ")").split())


def render_report(report: FinalReport, sources: dict[str, dict], *, question: str, revision_count: int,
                  model: str, clarifying_questions: list[str] | None = None) -> tuple[str, list[str]]:
    """Render the report as Markdown, laid out by report type.

    Citations are renumbered [1], [2]... in order of first use. Unknown source IDs are dropped and
    exact repeats in a row ("[S1][S1]") are collapsed. Evidence and limitations go last.
    """
    order: list[str] = []

    def sub(text: str) -> str:
        text = _DUP_CITES.sub(r"\1", text or "")

        def repl(m: re.Match) -> str:
            sid = m.group(1)
            if sid not in sources:
                return ""
            if sid not in order:
                order.append(sid)
            n = order.index(sid) + 1
            return f"[[{n}]]({citation_href(sid, sources[sid])})"
        out = _CITE.sub(repl, text)
        return re.sub(r"[ \t]+([.,;:])", r"\1", out).strip()  # no stray space where an invalid ID was removed

    kind = report.report_type
    parts = [f"# {report.title}", "", f"> **Request:** {question}", "", "## Answer", "", sub(report.summary), ""]
    if report.assumptions:
        parts += ["**Assumptions**", ""] + [f"- {sub(a)}" for a in report.assumptions] + [""]
    if clarifying_questions:
        parts += ["**To tailor this further, tell us:**", ""] + [f"- {q}" for q in clarifying_questions] + [""]

    # A finding counts as verified only if at least one of its citations resolves to a real source.
    verified, unverified = [], []
    for f in report.findings:
        (verified if any(sid in sources for sid in _CITE.findall(f)) else unverified).append(f)
    has_rec = bool(report.recommendation.strip())
    report = report.model_copy(update={"summary": cite_once_per_paragraph(report.summary),
                                       "recommendation": cite_once_per_paragraph(report.recommendation)})

    def sections(level: str = "##") -> list[str]:
        out: list[str] = []
        for sec in report.analysis:
            out += [f"{level} {sec.heading}", "", sub(cite_once_per_paragraph(sec.content)), ""]
        return out

    def key_points(heading: str) -> list[str]:
        return [f"## {heading}", ""] + [f"- {sub(k)}" for k in report.key_points] + [""] if report.key_points else []

    evidence_shown_in_body = False
    if kind == "comparison" and report.options and report.tradeoffs:
        opts = report.options
        parts += ["## Comparison", "", "| | " + " | ".join(_cell(o) for o in opts) + " |", "|---|" + "---|" * len(opts)]
        for row in report.tradeoffs:
            vals = (row.values + [""] * len(opts))[: len(opts)]
            parts.append(f"| **{_cell(row.criterion)}** | " + " | ".join(_cell(sub(v)) for v in vals) + " |")
        parts.append("")
        if report.choose_if or has_rec:
            parts += ["## When to choose each", ""]
            if has_rec:
                parts += [sub(report.recommendation), ""]
            parts += [f"- **{c.option}:** {sub(c.when)}" for c in report.choose_if] + [""]
        if report.analysis:
            parts += ["## More detail", ""] + sections("###")
    elif kind in ("study_plan", "how_to") and report.plan:
        parts += key_points(KEY_POINTS_HEADING[kind])
        if kind == "study_plan":
            timed = any(ph.time.strip() for ph in report.plan)
            parts += ["## Schedule", "", "| When | Focus |" + (" Time |" if timed else ""), "|---|---|" + ("---|" if timed else "")]
            parts += [f"| {_cell(ph.period)} | {_cell(sub(ph.focus))} |" + (f" {_cell(ph.time)} |" if timed else "") for ph in report.plan]
            parts += ["", "## Checklist", ""]
        else:
            parts += ["## Steps", ""]
        for ph in report.plan:
            parts += [f"### {ph.period}: {ph.focus}" if kind == "study_plan" else f"### {ph.period}. {ph.focus}", ""]
            tasks = sorted(ph.tasks, key=lambda t: ["high", "medium", "low"].index(t.priority))
            parts += [f"- [ ] {sub(t.task)}" + ("" if t.priority == "medium" else f" _({PRIORITY[t.priority]} priority)_")
                      for t in tasks] + [""]
        parts += sections()
        if report.example.strip():
            parts += ["## Example", "", sub(report.example), ""]
        if has_rec:
            parts += ["## Advice", "", sub(report.recommendation), ""]
    elif kind in ("explanation", "summary") and (report.key_points or report.analysis):
        parts += key_points(KEY_POINTS_HEADING[kind])
        steps = [s for s in report.diagram_steps if s.strip()]
        if kind == "explanation" and len(steps) >= 2:
            parts += [f"## {report.diagram_title.strip() or 'How it works'}", "", "```mermaid", "flowchart LR"]
            parts += [f'  s{i}["{_mermaid_label(t)}"]' + (f" --> s{i + 1}" if i < len(steps) else "") for i, t in enumerate(steps, 1)]
            parts += ["```", ""]
        parts += sections()
        if report.example.strip():
            parts += ["## Example", "", sub(report.example), ""]
        if has_rec:
            parts += ["## Recommendation", "", sub(report.recommendation), ""]
    else:  # research (and any type whose structured fields came back empty)
        if report.key_points:
            parts += key_points("Key findings")
        elif verified:  # no key points: the findings are the answer's body
            parts += ["## Key findings", ""] + [f"- {sub(x)}" for x in verified] + [""]
            evidence_shown_in_body = True
        parts += sections()
        if has_rec:
            parts += ["## Recommendation", "", sub(report.recommendation), ""]

    if verified and not evidence_shown_in_body:
        parts += ["## Evidence", ""] + [f"- {sub(x)}" for x in verified] + [""]
    limits = [sub(x) for x in report.limitations] + [f"Not verified (no valid source): {sub(x)}" for x in unverified]
    if limits:
        parts += ["## Limitations", ""] + [f"- {x}" for x in limits] + [""]
    parts += ["## Sources", ""]
    docs = [(i, sid) for i, sid in enumerate(order, start=1) if sources[sid].get("kind") == "document"]
    webs = [(i, sid) for i, sid in enumerate(order, start=1) if sources[sid].get("kind", "web") == "web"]
    if not docs:  # web-only reports keep a plain numbered list
        for i, sid in webs:
            s = sources[sid]
            parts.append(f"{i}. [{s['title'] or s['url']}]({s['url']}) · {source_type_label(s['url'])}")
    else:
        parts += ["**Uploaded documents**", ""]
        for i, sid in docs:
            s = sources[sid]
            loc = location(s)
            parts.append(f"- [[{i}]]({citation_href(sid, s)}) {s.get('filename') or s['title']}"
                         f"{', ' + loc if loc else ''} (passage {sid}, chunk `{s.get('chunk_id')}`)")
        if webs:
            parts += ["", "**Web sources**", ""]
            for i, sid in webs:
                s = sources[sid]
                parts.append(f"- [{i}] [{s['title'] or s['url']}]({s['url']}) · {source_type_label(s['url'])}")
    if not order:
        parts.append("_No sources were cited._")
    n_doc = sum(1 for v in sources.values() if v.get("kind") == "document")
    consulted = (f"Sources consulted: {len(sources)}" if not n_doc else
                 f"Web sources consulted: {len(sources) - n_doc}. Document passages retrieved: {n_doc}")
    parts += ["", "---",
              f"_{TYPE_LABEL[kind]} report generated by AgentOS (Alex, Milo, Luna) with {model} on "
              f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}. "
              f"Research rounds: {revision_count + 1}. {consulted}. Cited: {len(order)}._", ""]
    return "\n".join(parts), order
