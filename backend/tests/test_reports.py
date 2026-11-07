"""Report rendering by task type, citation handling, and source-type labels."""
import re

from agents.reviewer import render_report
from agents.schemas import ChooseIf, FinalReport, PlanPhase, PlanTask, ReportSection, TradeoffRow
from agents.sources import classify

SOURCES = {
    "S1": {"id": "S1", "kind": "web", "url": "https://www.postgresql.org/docs/17/ddl.html", "title": "PostgreSQL docs"},
    "S2": {"id": "S2", "kind": "web", "url": "https://www.mongodb.com/docs/manual/core/data-modeling/", "title": "MongoDB manual"},
    "S3": {"id": "S3", "kind": "web", "url": "https://medium.com/@x/pg-vs-mongo", "title": "A blog post"},
    "D1": {"id": "D1", "kind": "document", "url": "", "title": "Guide", "filename": "guide.md", "chunk_id": "doc_a-c0001",
           "page": None, "section": "Limits"},
}


def render(report, **kw):
    return render_report(report, SOURCES, question="Q?", revision_count=0, model="m", **kw)


def cites(md):
    return re.findall(r"\[\[(\d+)\]\]", md)


def test_comparison_answer_table_choose_if_then_collapsible_detail():
    r = FinalReport(
        report_type="comparison", title="PostgreSQL vs MongoDB", summary="Use PostgreSQL for this workload [S1].",
        findings=["PostgreSQL enforces foreign keys [S1].", "MongoDB embeds related data in documents [S2][S2]."],
        analysis=[ReportSection(heading="Consistency", content="Joins stay consistent [S1].")],
        recommendation="", limitations=["No benchmark for this exact workload."],
        options=["PostgreSQL", "MongoDB"],
        tradeoffs=[TradeoffRow(criterion="Schema", values=["Strict, migrations [S1]", "Flexible [S2]"]),
                   TradeoffRow(criterion="Joins | lookups", values=["Native", "$lookup, slower"])],
        choose_if=[ChooseIf(option="PostgreSQL", when="Data is relational."), ChooseIf(option="MongoDB", when="Documents vary.")],
    )
    md, order = render(r)
    i = md.index
    assert i("## Answer") < i("## Comparison") < i("## When to choose each") < i("## More detail") < i("## Evidence") \
        < i("## Limitations") < i("## Sources")
    assert "## Summary" not in md and "Verified" not in md and "## Recommendation" not in md
    assert "| | PostgreSQL | MongoDB |" in md and "| **Joins \\| lookups** | Native | $lookup, slower |" in md
    assert "- **PostgreSQL:** Data is relational." in md and "### Consistency" in md
    # duplicate adjacent citation collapsed, every distinct valid citation kept
    assert "documents [[2]](https://www.mongodb.com/docs/manual/core/data-modeling/)." in md
    assert order == ["S1", "S2"]
    assert "· official docs" in md
    assert "Comparison report generated" in md and "Cited: 2" in md


def test_study_plan_has_topics_schedule_checklist_assumptions_and_questions():
    r = FinalReport(
        report_type="study_plan", title="Two-week interview plan", summary="Spend week 1 on patterns and week 2 on mocks.",
        key_points=["Arrays and hash maps", "Behavioral stories"],
        findings=["Many interviews use 45-minute coding rounds [S3]."], analysis=[], recommendation="",
        limitations=[], assumptions=["Role: backend intern, 10 hours per week."],
        plan=[PlanPhase(period="Week 1", focus="Core patterns", time="2 h/day", tasks=[
                  PlanTask(task="Review sliding window notes", priority="low"),
                  PlanTask(task="Solve 3 medium array problems in 45 minutes each", priority="high"),
                  PlanTask(task="Write one SQL join query per day", priority="medium")]),
              PlanPhase(period="Week 2", focus="Mock interviews", tasks=[PlanTask(task="Do 2 timed mocks", priority="high")])],
    )
    md, order = render(r, clarifying_questions=["Which company and level is the interview for?"])
    i = md.index
    assert i("## Answer") < i("**Assumptions**") < i("## Topics to cover") < i("## Schedule") < i("## Checklist") < i("## Evidence")
    assert "| When | Focus | Time |" in md and "| Week 1 | Core patterns | 2 h/day |" in md and "| Week 2 | Mock interviews |  |" in md
    w1 = md[md.index("### Week 1"):md.index("### Week 2")]
    # high priority first, medium unlabeled, low labeled
    assert w1.index("Solve 3 medium") < w1.index("Write one SQL") < w1.index("Review sliding")
    assert "- [ ] Solve 3 medium array problems in 45 minutes each _(High priority)_" in w1
    assert "- [ ] Write one SQL join query per day\n" in w1
    assert "**To tailor this further, tell us:**" in md and "Which company" in md
    assert "## Recommendation" not in md and "## Advice" not in md
    assert "· blog/forum" in md and order == ["S3"]


def test_explanation_has_key_ideas_diagram_sections_and_example():
    r = FinalReport(
        report_type="explanation", title="How HTTPS works", summary="TLS encrypts HTTP after a handshake [S1].",
        key_points=["The handshake agrees on keys.", "Certificates prove the server's identity [S1]."],
        findings=["TLS 1.3 needs one round trip for a full handshake [S1]."],
        analysis=[ReportSection(heading="The handshake", content="Client and server agree on a key.")],
        recommendation="", limitations=[], diagram_title="A request over HTTPS",
        diagram_steps=["Client hello", 'Server "hello" + cert', "Key exchange", "Encrypted HTTP"],
        example="```bash\ncurl -v https://example.com\n```",
    )
    md, order = render(r)
    i = md.index
    assert i("## Answer") < i("## Key ideas") < i("## A request over HTTPS") < i("## The handshake") < i("## Example") < i("## Evidence")
    assert "```mermaid\nflowchart LR\n  s1[\"Client hello\"] --> s2\n  s2[\"Server 'hello' + cert\"] --> s3" in md
    assert '  s4["Encrypted HTTP"]\n```' in md
    assert "```bash\ncurl -v https://example.com\n```" in md  # code keeps its line breaks
    assert "Explanation report generated" in md and order == ["S1"]


def test_document_summary_has_takeaways_and_document_citations():
    r = FinalReport(report_type="summary", title="Aurora guide", summary="The guide sets a 137-record batch limit [D1].",
                    key_points=["Batches above 137 records fail [D1]."], findings=["Aurora accepts at most 137 records per batch [D1]."],
                    analysis=[ReportSection(heading="Batch limits", content="Split larger batches [D1].")],
                    recommendation="", limitations=[])
    md, order = render(r)
    assert md.index("## Main takeaways") < md.index("## Batch limits") < md.index("## Evidence")
    assert "**Uploaded documents**" in md and "guide.md, section \"Limits\"" in md and "(#evidence-D1)" in md
    assert "Document summary report generated" in md and order == ["D1"]


def test_research_without_key_points_shows_findings_and_no_duplicate_evidence():
    r = FinalReport(report_type="research", title="Aurora limits", summary="The limit is 137 records [D1].",
                    findings=["Aurora accepts at most 137 records per batch [D1].", "Unverified claim"],
                    analysis=[ReportSection(heading="Behavior above the limit", content="Larger batches fail [D1].")],
                    recommendation="", limitations=["One document only."])
    md, order = render(r)
    assert "## Key findings" in md and "## Behavior above the limit" in md and "## Recommendation" not in md
    assert "## Evidence" not in md  # the findings already are the body
    assert "Not verified (no valid source): Unverified claim" in md
    assert order == ["D1"] and set(cites(md)) == {"1"}


def test_research_with_key_points_moves_findings_to_evidence():
    r = FinalReport(report_type="research", title="T", summary="S.", key_points=["K [S1]."],
                    findings=["F [S2]."], analysis=[], recommendation="", limitations=[])
    md, order = render(r)
    assert md.index("## Key findings") < md.index("## Evidence") and "- K [[1]]" in md and order == ["S1", "S2"]


def test_structured_types_fall_back_when_fields_are_empty():
    r = FinalReport(report_type="comparison", title="T", summary="S [S1].", findings=["F [S1]."], analysis=[],
                    recommendation="R.", limitations=[])
    md, _ = render(r)
    assert "## Comparison" not in md and "## Key findings" in md and "## Recommendation" in md


def test_source_types():
    assert classify("https://www.postgresql.org/docs/17/") == "official"
    assert classify("https://docs.python.org/3/library/asyncio.html") == "official"
    assert classify("https://learn.microsoft.com/en-us/azure/") == "official"
    assert classify("https://datatracker.ietf.org/doc/html/rfc9110") == "standard"
    assert classify("https://arxiv.org/abs/2401.00001") == "paper"
    assert classify("https://medium.com/@someone/post") == "community"
    assert classify("https://stackoverflow.com/questions/1") == "community"
    assert classify("https://github.com/qdrant/qdrant") == "official"
    assert classify("https://github.com/qdrant/qdrant/issues/1") == "community"
    assert classify("https://en.wikipedia.org/wiki/PostgreSQL") == "reference"
    assert classify("https://someblog.example.com/blog/post") == "community"
    assert classify("not a url") == "other"
    assert classify("https://www.mongodb.com/community/forums/t/schema-design/123") == "community"
    assert classify("https://discuss.python.org/t/free-threading/1") == "community"
    assert classify("https://www.mongodb.com/docs/manual/") == "official"


def test_repeated_citation_in_a_paragraph_is_cited_once_at_the_end():
    from agents.reviewer import cite_once_per_paragraph as once
    assert once("A [S1]. B [S1]. C [S1].") == "A. B. C [S1]."
    assert once("A [S1]. B [S2]. C [S1].") == "A [S1]. B [S2]. C [S1]."  # different sources in between: kept
    assert once("A [S1].\n\nB [S1].") == "A [S1].\n\nB [S1]."  # separate paragraphs: kept
    assert once("x [S1]\n```\ncode [S1] [S1]\n```\ny [S1].") == "x [S1]\n```\ncode [S1] [S1]\n```\ny [S1]."
    r = FinalReport(report_type="explanation", title="T", summary="S.", key_points=["K."], findings=["F [S1]."],
                    analysis=[ReportSection(heading="H", content="One [S1]. Two [S1].")], recommendation="", limitations=[])
    md, order = render(r)
    assert "One. Two [[1]]" in md and order == ["S1"]
