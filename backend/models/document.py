import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Float, Integer, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from database import Base

DocumentStatus = SAEnum(
    "processing", "ocr_complete", "extracting", "ready",
    "confirmed", "generating", "generated", "validation_failed", "approved",
    "failed", "ocr_failed",
    name="document_status",
)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    minio_key: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(DocumentStatus, nullable=False, default="processing", index=True)
    # Stored encrypted (AES-256-GCM); null until OCR completes
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    # Soft delete — never hard-delete clinical records
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
