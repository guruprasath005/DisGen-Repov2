import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Text, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from database import Base

SummaryStatus = SAEnum("draft", "validation_failed", "approved", name="summary_status")



def _utcnow() -> datetime:
    """Timezone-aware UTC `now`. Replaces deprecated `datetime.utcnow`."""
    return datetime.now(timezone.utc)


class Scheme(Base):
    __tablename__ = "schemes"

    # String PK: 'pmjay', 'cghs', 'esi', 'cmchis', 'private', or UUID for custom
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    required_fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    optional_fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    rules: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    pdf_sections: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    pdf_template: Mapped[str] = mapped_column(String(100), default="custom.html", nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class GeneratedSummary(Base):
    __tablename__ = "generated_summaries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    scheme: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # summary_text: legacy free-text field — nullable since migration 0007.
    # New rows use summary_fields instead.
    summary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # summary_fields: {field_name: value | null} produced by the scheme-field
    # LLM generator. Primary output for the new field-based workflow.
    summary_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(SummaryStatus, nullable=False, default="draft")
    validation_notes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    generated_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    # Lineage tracking (migration 0006): at most one is_active=True row per
    # (document_id, scheme). When a new generation supersedes a prior one,
    # the prior row gets is_active=False and superseded_by_id set to the new row.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("generated_summaries.id", use_alter=True, name="fk_superseded_by"),
        nullable=True,
    )
