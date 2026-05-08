"""
Azure Document Intelligence OCR client — Central India (Pune).

Chosen over AWS Textract because:
  - Handles degraded photocopies, handwriting, and mixed printed/handwritten content
  - Critical for Indian hospitals where discharge summaries are often low-quality
    photocopies or scanned forms with handwritten sections
  - ~15x cheaper than Textract (~₹0.08/page vs ~₹1.25/page)
  - Data stays in India (Central India region). DPDP compliant.

Uses the prebuilt-layout model with KEY_VALUE_PAIRS feature enabled:
  - Full text extraction (printed + handwritten)
  - Table detection and reconstruction
  - Form key-value pair extraction (e.g. "Patient Name: ...")
  - Handles multi-page PDFs and all common image formats natively

No temporary storage required — bytes sent directly to the API, unlike
Textract which requires an S3 upload for PDFs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import ClassVar

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import (
    AnalyzeDocumentRequest,
    AnalyzeResult,
    DocumentAnalysisFeature,
)
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError, ServiceRequestError

from config import settings

logger = logging.getLogger(__name__)


class OCRFailedError(Exception):
    """Raised when Azure Document Intelligence returns a service or transport error."""


@dataclass
class OCRResult:
    """Structured output from a single document analysis pass."""

    full_text: str
    tables: list[dict] = field(default_factory=list)
    key_values: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0
    pages: int = 0
    sections: dict[str, str] = field(default_factory=dict)


class AzureDocumentClient:
    """
    Singleton wrapper around Azure Document Intelligence.

    Uses prebuilt-layout model which handles degraded photocopies, mixed
    handwritten/printed forms, and scanned PDFs — common in Indian hospitals.

    All API calls target Central India (Pune). DPDP compliant.
    Each Celery worker process gets its own singleton via the class variable.
    """

    _instance: ClassVar[AzureDocumentClient | None] = None

    def __init__(self) -> None:
        self._client = DocumentIntelligenceClient(
            endpoint=settings.azure_document_endpoint,
            credential=AzureKeyCredential(settings.azure_document_key),
        )
        logger.info(
            "AzureDocumentClient initialised (endpoint=%s)",
            settings.azure_document_endpoint,
        )

    @classmethod
    def get_instance(cls) -> AzureDocumentClient:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Public API ─────────────────────────────────────────────────────────────

    def analyze_document(self, file_bytes: bytes, content_type: str) -> OCRResult:
        """
        Submit file bytes to Azure Document Intelligence and return structured output.

        content_type: application/pdf | image/jpeg | image/png | image/tiff

        Azure handles both images and PDFs natively — no S3 temp upload needed.
        Raises OCRFailedError on any service or transport error.
        """
        logger.info(
            "Sending %d bytes to Azure Document Intelligence (type=%s)",
            len(file_bytes),
            content_type,
        )
        try:
            poller = self._client.begin_analyze_document(
                "prebuilt-layout",
                body=AnalyzeDocumentRequest(bytes_source=file_bytes),
                # KEY_VALUE_PAIRS extracts labelled form fields (e.g. Patient Name: ...)
                # which are common in Indian hospital discharge summary forms.
                features=[DocumentAnalysisFeature.KEY_VALUE_PAIRS],
            )
            # 5-minute hard timeout — prevents the worker from hanging forever
            # if Azure is slow or the connection drops mid-analysis.
            result = poller.result(timeout=300)
            return self._parse_result(result)
        except (HttpResponseError, ServiceRequestError) as exc:
            raise OCRFailedError(
                f"Azure Document Intelligence error: {exc}"
            ) from exc
        except OCRFailedError:
            raise
        except Exception as exc:
            raise OCRFailedError(f"Unexpected OCR error: {exc}") from exc

    # ── Result parsing ─────────────────────────────────────────────────────────

    def _parse_result(self, result: AnalyzeResult) -> OCRResult:
        pages = result.pages or []
        page_count = len(pages)

        # Full text — Azure returns the complete document content as a single string.
        full_text = result.content or ""

        # Per-page sections and word-level confidence scores.
        sections: dict[str, str] = {}
        word_confidences: list[float] = []
        for page in pages:
            lines = [ln.content for ln in (page.lines or []) if ln.content]
            if lines:
                sections[f"Page {page.page_number}"] = " ".join(lines)
            for word in page.words or []:
                if word.confidence is not None:
                    word_confidences.append(word.confidence)

        confidence = (
            round(sum(word_confidences) / len(word_confidences), 4)
            if word_confidences
            else 0.9
        )

        # Tables — Azure cell indices are 0-based; convert to 1-based for
        # consistency with the rest of the pipeline.
        tables: list[dict] = []
        for table in result.tables or []:
            cells: dict[tuple[int, int], str] = {}
            max_row = max_col = 0
            for cell in table.cells or []:
                r = cell.row_index + 1
                c = cell.column_index + 1
                cells[(r, c)] = cell.content or ""
                max_row = max(max_row, r)
                max_col = max(max_col, c)

            if not cells:
                continue

            headers = [cells.get((1, c), "") for c in range(1, max_col + 1)]
            rows: list[dict[str, str]] = []
            for r in range(2, max_row + 1):
                row: dict[str, str] = {}
                for c in range(1, max_col + 1):
                    key = headers[c - 1] if c - 1 < len(headers) else str(c)
                    row[key] = cells.get((r, c), "")
                rows.append(row)

            bounding_regions = table.bounding_regions or []
            page_num = bounding_regions[0].page_number if bounding_regions else 1
            tables.append({"headers": headers, "rows": rows, "page": page_num})

        # Key-value pairs — skip entries with no value or low confidence.
        key_values: dict[str, str] = {}
        for kv in result.key_value_pairs or []:
            if not (kv.key and kv.value and kv.confidence and kv.confidence >= 0.5):
                continue
            k = kv.key.content or ""
            v = kv.value.content or ""
            if k and v:
                key_values[k] = v

        return OCRResult(
            full_text=full_text,
            tables=tables,
            key_values=key_values,
            confidence=confidence,
            pages=page_count,
            sections=sections,
        )
