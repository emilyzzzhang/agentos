"""Split parsed sections into overlapping chunks. A chunk never spans two pages or two sections,
so every chunk keeps exactly one page or section reference."""
from __future__ import annotations

from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from .parsing import Section


@dataclass
class Chunk:
    index: int
    text: str
    page: int | None
    section: str | None

    def chunk_id(self, document_id: str) -> str:
        return f"{document_id}-c{self.index:04d}"


def chunk_sections(sections: list[Section], *, chunk_size: int, chunk_overlap: int) -> list[Chunk]:
    if chunk_size < 100:
        raise ValueError("chunk_size must be at least 100 characters")
    if not 0 <= chunk_overlap < chunk_size:
        raise ValueError("chunk_overlap must be >= 0 and smaller than chunk_size")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""], keep_separator="end",
    )
    chunks: list[Chunk] = []
    for sec in sections:
        for piece in splitter.split_text(sec.text):
            piece = piece.strip()
            if piece:
                chunks.append(Chunk(index=len(chunks), text=piece, page=sec.page, section=sec.heading))
    return chunks
