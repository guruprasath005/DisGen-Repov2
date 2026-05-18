import uuid
from datetime import datetime, timezone
from sqlalchemy import Text, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from database import Base


class StructuredReport(Base):
    __tablename__ = "structured_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # One report per document
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), unique=True, nullable=False, index=True)
    # Full structured JSON, AES-256-GCM encrypted. Never stored in plaintext.
    data: Mapped[str] = mapped_column(Text, nullable=False)
    data_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Fields the doctor toggled off — excluded from generation
    excluded_fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # Increments on every doctor edit for audit trail
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    # Encrypted JSON map of PHI placeholders used during extraction (phi_filter.py).
    # Required for re-identification if original values need to be restored.
    phi_map: Mapped[str | None] = mapped_column(Text, nullable=True)
