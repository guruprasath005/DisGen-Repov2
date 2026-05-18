import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from database import Base

AuditAction = SAEnum(
    "LOGIN", "LOGIN_FAILED", "LOGOUT",
    "UPLOAD", "OCR_COMPLETE", "EXTRACT_COMPLETE",
    "STRUCTURED_UPDATE", "STRUCTURED_CONFIRM",
    "GENERATE", "GENERATE_FAILED", "APPROVE",
    "PDF_DOWNLOAD", "DOCUMENT_DELETE",
    "USER_CREATE", "USER_DEACTIVATE",
    "SCHEME_CREATE", "SCHEME_UPDATE", "SCHEME_DELETE",
    "SETTINGS_CHANGE", "RETENTION_ENFORCED",
    "ACCOUNT_LOCKED",
    "FIELD_EDIT",
    "REPROCESS", "REEXTRACT",
    name="audit_action",
)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(AuditAction, nullable=False, index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # IPv6 max = 45 chars
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    hospital_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    # Hash chain fields — set by audit.create_audit_log(), never set directly
    prev_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    hash: Mapped[str | None] = mapped_column(Text, nullable=True)
