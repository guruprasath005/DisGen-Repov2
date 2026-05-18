import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Text, Boolean, Integer, Date, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from database import Base

ConsentMethod = SAEnum("verbal", "written", "digital", name="consent_method")


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    # AES-256-GCM encrypted. Use safe_decrypt() on read — pre-hardening rows are plaintext.
    patient_name: Mapped[str] = mapped_column(Text, nullable=False)
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_method: Mapped[str] = mapped_column(ConsentMethod, nullable=False)
    consent_date: Mapped[date] = mapped_column(Date, nullable=False)
    recorded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class HospitalConfig(Base):
    """Singleton row — always id=1."""
    __tablename__ = "hospital_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(500), nullable=False, default="Hospital Name")
    logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    default_scheme: Mapped[str] = mapped_column(String(50), default="pmjay", nullable=False)
    pdf_header_color: Mapped[str] = mapped_column(String(7), default="#F97316", nullable=False)
    pdf_accent_color: Mapped[str] = mapped_column(String(7), default="#EA580C", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class RetentionSettings(Base):
    """Singleton row — always id=1."""
    __tablename__ = "retention_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # 2555 days = 7 years, DPDP minimum
    retention_days: Mapped[int] = mapped_column(Integer, default=2555, nullable=False)
    auto_delete: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    anonymize_on_expiry: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
