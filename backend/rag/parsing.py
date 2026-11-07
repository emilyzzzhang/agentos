"""Parse uploaded files into text sections that keep their source location.

Uploaded files are untrusted: types are checked by content (not only by extension), binary
data is rejected, page counts are bounded, and parser errors become `ParseError` with a
message that is safe to show the user. No OCR: scanned PDFs without a text layer fail with
an explicit message.
"""
from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Literal

FileType = Literal["pdf", "markdown", "text"]

EXTENSIONS: dict[str, FileType] = {".pdf": "pdf", ".md": "markdown", ".markdown": "markdown", ".txt": "text"}
CONTENT_TYPES: dict[FileType, str] = {"pdf": "application/pdf", "markdown": "text/markdown", "text": "text/plain"}


class UnsupportedFile(ValueError):
    pass


class ParseError(ValueError):
    pass


@dataclass
class Section:
    text: str
    page: int | None = None       # 1-based PDF page
    heading: str | None = None    # Markdown heading path, e.g. "Limits > Batch size"


@dataclass
class ParsedDocument:
    file_type: FileType
    sections: list[Section]
    title: str | None = None
    page_count: int | None = None
    warnings: list[str] = field(default_factory=list)


def safe_filename(name: str) -> str:
    """Display name only (storage keys never use it): no path parts, no control characters."""
    base = PurePath(name.replace("\\", "/")).name
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C").strip()
    return (base or "document")[:200]


def detect_file_type(filename: str, data: bytes) -> FileType:
    ext = PurePath(filename.lower()).suffix
    file_type = EXTENSIONS.get(ext)
    if file_type is None:
        raise UnsupportedFile(f"Unsupported file type {ext or '(none)'}. Upload PDF, Markdown (.md) or text (.txt) files.")
    if file_type == "pdf":
        if not data.lstrip()[:5].startswith(b"%PDF-"):
            raise UnsupportedFile("The file has a .pdf extension but is not a PDF.")
    elif b"\x00" in data[:65536]:
        raise UnsupportedFile("The file looks binary. Markdown and text files must contain plain text.")
    return file_type


# ---------- cleaning ----------

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str, *, pdf: bool = False) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text).replace("­", "")  # soft hyphens
    if pdf:
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)          # re-join words hyphenated across lines
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ParseError("Could not decode the file as UTF-8 or Windows-1252 text.")


# ---------- parsers ----------

def parse_pdf(data: bytes, *, max_pages: int) -> ParsedDocument:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ParseError("The PDF is password-protected.")
        n = len(reader.pages)
    except ParseError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, OSError) as exc:
        raise ParseError(f"The PDF is malformed or unreadable ({type(exc).__name__}).") from exc
    if n == 0:
        raise ParseError("The PDF has no pages.")
    if n > max_pages:
        raise ParseError(f"The PDF has {n} pages; the limit is {max_pages}.")
    sections: list[Section] = []
    warnings: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = clean_text(page.extract_text() or "", pdf=True)
        except Exception as exc:  # one bad page should not sink the document
            warnings.append(f"Page {i} could not be read ({type(exc).__name__}).")
            continue
        if text:
            sections.append(Section(text=text, page=i))
    if not sections:
        raise ParseError("The PDF has no extractable text. Scanned PDFs need OCR, which is not supported yet.")
    empty = n - len(sections) - len(warnings)
    if empty:
        warnings.append(f"{empty} of {n} pages had no text layer and were skipped.")
    title = None
    try:
        if reader.metadata and reader.metadata.title:
            title = clean_text(str(reader.metadata.title))[:200] or None
    except Exception:  # broken metadata is not worth failing the document
        pass
    return ParsedDocument("pdf", sections, title=title, page_count=n, warnings=warnings)


_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^[ \t]*(```|~~~)")


def parse_markdown(data: bytes) -> ParsedDocument:
    text = _decode(data).replace("\r\n", "\n")
    stack: list[tuple[int, str]] = []
    sections: list[Section] = []
    buf: list[str] = []
    in_fence = False
    title = None

    def flush():
        body = clean_text("\n".join(buf))
        if body:
            sections.append(Section(text=body, heading=" > ".join(h for _, h in stack) or None))
        buf.clear()

    for line in text.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
        m = None if in_fence else _HEADING.match(line)
        if m:
            flush()
            level, heading = len(m.group(1)), clean_text(m.group(2))
            stack = [(lv, h) for lv, h in stack if lv < level] + [(level, heading)]
            if level == 1 and title is None:
                title = heading
            continue
        buf.append(line)
    flush()
    if not sections:
        raise ParseError("The Markdown file contains no text.")
    return ParsedDocument("markdown", sections, title=title)


def parse_text(data: bytes) -> ParsedDocument:
    text = clean_text(_decode(data))
    if not text:
        raise ParseError("The text file is empty.")
    return ParsedDocument("text", [Section(text=text)])


def parse_document(data: bytes, file_type: FileType, *, max_pages: int = 1000) -> ParsedDocument:
    if not data:
        raise ParseError("The file is empty.")
    if file_type == "pdf":
        return parse_pdf(data, max_pages=max_pages)
    if file_type == "markdown":
        return parse_markdown(data)
    return parse_text(data)
