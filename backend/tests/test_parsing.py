import pytest

from rag.chunking import chunk_sections
from rag.parsing import (ParseError, Section, UnsupportedFile, clean_text, detect_file_type, parse_document,
                         safe_filename)

from .pdfgen import make_pdf


def test_pdf_pages_title_and_skipped_scanned_pages():
    data = make_pdf(["Intro page about Aurora.", "", "Project Aurora supports a maximum batch size of 137 records."],
                    title="Aurora Spec")
    assert detect_file_type("spec.PDF", data) == "pdf"
    doc = parse_document(data, "pdf")
    assert doc.page_count == 3 and doc.title == "Aurora Spec"
    assert [s.page for s in doc.sections] == [1, 3]  # page 2 has no text layer
    assert "137 records" in doc.sections[1].text
    assert any("no text layer" in w for w in doc.warnings)


def test_pdf_without_text_layer_and_malformed_pdf_fail_clearly():
    with pytest.raises(ParseError, match="OCR"):
        parse_document(make_pdf(["", ""]), "pdf")
    with pytest.raises(ParseError, match="malformed"):
        parse_document(b"%PDF-1.4\nthis is not really a pdf", "pdf")
    with pytest.raises(ParseError, match="limit"):
        parse_document(make_pdf(["a", "b", "c"]), "pdf", max_pages=2)


def test_markdown_keeps_heading_paths_and_ignores_code_fences():
    md = b"""# Aurora Guide

Overview text.

## Limits

### Batch size

Project Aurora supports a maximum batch size of 137 records.

```python
# not a heading
x = 1
```

## Other
Done.
"""
    doc = parse_document(md, "markdown")
    assert doc.title == "Aurora Guide"
    heads = [s.heading for s in doc.sections]
    assert heads == ["Aurora Guide", "Aurora Guide > Limits > Batch size", "Aurora Guide > Other"]
    assert "# not a heading" in doc.sections[1].text


def test_text_and_validation():
    assert parse_document("caf\u00e9 notes\r\n\r\n\r\nline".encode(), "text").sections[0].text == "café notes\n\nline"
    assert parse_document("legacy \xe9".encode("cp1252"), "text").sections[0].text == "legacy é"
    with pytest.raises(ParseError):
        parse_document(b"   \n\t ", "text")
    with pytest.raises(ParseError):
        parse_document(b"", "markdown")
    with pytest.raises(UnsupportedFile):
        detect_file_type("evil.exe", b"MZ")
    with pytest.raises(UnsupportedFile, match="not a PDF"):
        detect_file_type("fake.pdf", b"<html>")
    with pytest.raises(UnsupportedFile, match="binary"):
        detect_file_type("notes.txt", b"abc\x00def")
    assert safe_filename("../../etc/pa\x00ss\u202ewd.md") == "passwd.md"
    assert safe_filename("C:\\Users\\me\\report.pdf") == "report.pdf"
    assert clean_text("multi-\nline   text\x07", pdf=True) == "multiline text"


def test_chunking_preserves_location_and_overlap():
    long = " ".join(f"Sentence {i} describes Aurora behavior in detail." for i in range(60))
    sections = [Section(text=long, page=4), Section(text="Short section.", heading="Limits")]
    chunks = chunk_sections(sections, chunk_size=300, chunk_overlap=60)
    assert len(chunks) > 5
    assert all(len(c.text) <= 300 for c in chunks)
    assert {c.page for c in chunks[:-1]} == {4} and chunks[-1].section == "Limits" and chunks[-1].page is None
    assert [c.index for c in chunks] == list(range(len(chunks)))
    # consecutive chunks of the same section overlap
    tail = chunks[0].text[-30:].split(" ", 1)[1]
    assert tail[:15] in chunks[1].text
    assert chunks[3].chunk_id("doc_x") == "doc_x-c0003"
    with pytest.raises(ValueError):
        chunk_sections(sections, chunk_size=200, chunk_overlap=200)
