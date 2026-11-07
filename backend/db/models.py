"""SQLAlchemy models. Schema changes go through Alembic (db/migrations).

Every user-owned row carries `workspace_id`. There is one local workspace today; the column
exists so authenticated multi-workspace access can be added without reshaping the data.
Types are portable (PostgreSQL in the app, SQLite in unit tests).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSONType = sa.JSON(none_as_null=True).with_variant(postgresql.JSONB(none_as_null=True), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONType, list[Any]: JSONType, datetime: sa.DateTime(timezone=True)}


DOCUMENT_STATUSES = ("pending", "processing", "ready", "failed")
MISSION_STATUSES = ("running", "completed", "failed", "cancelled", "interrupted")


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(200))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Mission(Base):
    __tablename__ = "missions"
    id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)  # run_id
    workspace_id: Mapped[str] = mapped_column(sa.ForeignKey("workspaces.id"), index=True)
    question: Mapped[str] = mapped_column(sa.Text)
    mode: Mapped[str] = mapped_column(sa.String(16))
    status: Mapped[str] = mapped_column(sa.String(16), index=True)
    error: Mapped[str | None] = mapped_column(sa.Text)
    model: Mapped[str | None] = mapped_column(sa.String(100))
    # null = all ready documents in the workspace; [] = web only; [ids] = user selection
    document_scope: Mapped[list[Any] | None] = mapped_column(JSONType)
    plan: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    report_title: Mapped[str | None] = mapped_column(sa.Text)
    report_path: Mapped[str | None] = mapped_column(sa.Text)
    report_markdown: Mapped[str | None] = mapped_column(sa.Text)
    cited_sources: Mapped[list[Any] | None] = mapped_column(JSONType)
    research_rounds: Mapped[int | None]
    source_count: Mapped[int | None]
    event_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    finished_at: Mapped[datetime | None]

    events: Mapped[list[MissionEvent]] = relationship(
        back_populates="mission", cascade="all, delete-orphan", passive_deletes=True, order_by="MissionEvent.seq")
    evidence: Mapped[list[MissionEvidence]] = relationship(
        back_populates="mission", cascade="all, delete-orphan", passive_deletes=True)


class MissionEvent(Base):
    __tablename__ = "mission_events"
    __table_args__ = (sa.UniqueConstraint("mission_id", "seq", name="uq_mission_events_mission_seq"),)
    id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)  # evt_<hex>
    mission_id: Mapped[str] = mapped_column(sa.ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int]
    type: Mapped[str] = mapped_column(sa.String(48))
    agent_id: Mapped[str | None] = mapped_column(sa.String(32))
    task_id: Mapped[str | None] = mapped_column(sa.String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType)
    timestamp: Mapped[datetime]

    mission: Mapped[Mission] = relationship(back_populates="events")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (sa.UniqueConstraint("workspace_id", "sha256", name="uq_documents_workspace_sha256"),)
    id: Mapped[str] = mapped_column(sa.String(40), primary_key=True)  # doc_<hex>
    workspace_id: Mapped[str] = mapped_column(sa.ForeignKey("workspaces.id"), index=True)
    filename: Mapped[str] = mapped_column(sa.String(255))
    title: Mapped[str] = mapped_column(sa.String(255))
    file_type: Mapped[str] = mapped_column(sa.String(16))  # pdf | markdown | text
    content_type: Mapped[str] = mapped_column(sa.String(100))
    size_bytes: Mapped[int] = mapped_column(sa.BigInteger)
    sha256: Mapped[str] = mapped_column(sa.String(64))
    storage_key: Mapped[str] = mapped_column(sa.String(512))
    status: Mapped[str] = mapped_column(sa.String(16), index=True)
    error: Mapped[str | None] = mapped_column(sa.Text)
    page_count: Mapped[int | None]
    chunk_count: Mapped[int] = mapped_column(default=0)
    embedding_model: Mapped[str | None] = mapped_column(sa.String(200))
    embedding_dim: Mapped[int | None]
    chunk_size: Mapped[int | None]
    chunk_overlap: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    indexed_at: Mapped[datetime | None]

    chunks: Mapped[list[DocumentChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True, order_by="DocumentChunk.chunk_index")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)  # <document_id>-c0007
    document_id: Mapped[str] = mapped_column(sa.ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str] = mapped_column(sa.String(64), index=True)
    chunk_index: Mapped[int]
    text: Mapped[str] = mapped_column(sa.Text)
    page: Mapped[int | None]
    section: Mapped[str | None] = mapped_column(sa.Text)
    char_count: Mapped[int]

    document: Mapped[Document] = relationship(back_populates="chunks")


class MissionEvidence(Base):
    """Every source a mission gathered (web results and document passages), keyed by its citation ID."""
    __tablename__ = "mission_evidence"
    mission_id: Mapped[str] = mapped_column(sa.ForeignKey("missions.id", ondelete="CASCADE"), primary_key=True)
    evidence_id: Mapped[str] = mapped_column(sa.String(16), primary_key=True)  # S3 (web) | D2 (document)
    workspace_id: Mapped[str] = mapped_column(sa.String(64), index=True)
    kind: Mapped[str] = mapped_column(sa.String(16))  # web | document
    title: Mapped[str] = mapped_column(sa.Text)
    url: Mapped[str | None] = mapped_column(sa.Text)
    document_id: Mapped[str | None] = mapped_column(sa.ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    chunk_id: Mapped[str | None] = mapped_column(sa.String(64))
    page: Mapped[int | None]
    section: Mapped[str | None] = mapped_column(sa.Text)
    query: Mapped[str | None] = mapped_column(sa.Text)
    score: Mapped[float | None]
    # Snapshot of the retrieved passage, so the report stays checkable. Cleared when the document is deleted.
    text: Mapped[str | None] = mapped_column(sa.Text)
    cited: Mapped[bool] = mapped_column(default=False)
    citation_number: Mapped[int | None]

    mission: Mapped[Mission] = relationship(back_populates="evidence")
