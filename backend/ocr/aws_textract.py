"""
AWS Textract OCR client — ap-south-1 (Mumbai, India).

Replaces Google Cloud Document AI. All data stays in India. DPDP compliant.

Two processing paths:
  Images (JPEG/PNG/TIFF) — synchronous analyze_document(), bytes sent directly,
                            results returned in one API call.
  PDFs                   — asynchronous start_document_analysis(), requires S3.
                            File is uploaded to a temp S3 key, processed, then
                            IMMEDIATELY deleted from S3 (in a finally block so
                            deletion always runs, even on failure).

No page limits: Textract async handles up to 3 000 pages per document.

Singleton per process. Call AWSTextractClient.get_instance() — never instantiate
directly. Each Celery worker process gets its own singleton via the class var.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import ClassVar

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from config import settings

logger = logging.getLogger(__name__)

_PDF_MIME = "application/pdf"


class OCRFailedError(Exception):
    """Raised when AWS Textract returns a service or transport error."""


@dataclass
class OCRResult:
    """Structured output from a single document analysis pass."""

    full_text: str
    tables: list[dict] = field(default_factory=list)
    key_values: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0
    pages: int = 0
    sections: dict[str, str] = field(default_factory=dict)


class AWSTextractClient:
    """
    Singleton wrapper around boto3 Textract + S3 clients.

    All API calls target ap-south-1 (Mumbai). Credentials are read from
    settings (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env).
    """

    _instance: ClassVar[AWSTextractClient | None] = None

    def __init__(self) -> None:
        session = boto3.Session(
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
        )
        self._textract = session.client("textract")
        self._s3 = session.client("s3")
        self._bucket = settings.aws_textract_bucket
        logger.info(
            "AWSTextractClient initialised (region=%s bucket=%s)",
            settings.aws_region,
            self._bucket,
        )

    @classmethod
    def get_instance(cls) -> AWSTextractClient:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Public API ─────────────────────────────────────────────────────────────

    def analyze_document(self, file_bytes: bytes, content_type: str) -> OCRResult:
        """
        Submit file bytes to AWS Textract and return structured OCR output.

        content_type: application/pdf | image/jpeg | image/png | image/tiff

        Raises OCRFailedError on any service or transport error.
        """
        logger.info(
            "Sending %d bytes to AWS Textract (type=%s region=%s)",
            len(file_bytes),
            content_type,
            settings.aws_region,
        )
        try:
            if content_type == _PDF_MIME:
                return self._process_pdf(file_bytes)
            return self._process_image(file_bytes)
        except OCRFailedError:
            raise
        except (BotoCoreError, ClientError) as exc:
            raise OCRFailedError(f"AWS Textract API error: {exc}") from exc
        except Exception as exc:
            raise OCRFailedError(f"Unexpected OCR error: {exc}") from exc

    # ── Synchronous path (images) ──────────────────────────────────────────────

    def _process_image(self, file_bytes: bytes) -> OCRResult:
        """Synchronous Textract for JPEG/PNG/TIFF — bytes sent directly."""
        response = self._textract.analyze_document(
            Document={"Bytes": file_bytes},
            FeatureTypes=["TABLES", "FORMS"],
        )
        return self._parse_blocks(response.get("Blocks", []), page_count=1)

    # ── Asynchronous path (PDFs) ───────────────────────────────────────────────

    def _process_pdf(self, file_bytes: bytes) -> OCRResult:
        """
        Asynchronous Textract for PDFs.

        Uploads to S3 → starts job → polls until complete → deletes from S3.
        The S3 object is always deleted in the finally block, even on failure,
        so patient data is never left behind in S3.
        """
        s3_key = f"textract-temp/{uuid.uuid4()}.pdf"
        try:
            self._s3.put_object(
                Bucket=self._bucket,
                Key=s3_key,
                Body=file_bytes,
                ContentType=_PDF_MIME,
            )
            logger.debug("Uploaded PDF to s3://%s/%s", self._bucket, s3_key)

            job_id: str = self._textract.start_document_analysis(
                DocumentLocation={
                    "S3Object": {"Bucket": self._bucket, "Name": s3_key}
                },
                FeatureTypes=["TABLES", "FORMS"],
            )["JobId"]
            logger.info("Textract async job started: %s", job_id)

            blocks = self._poll_job(job_id)
            return self._parse_blocks(blocks)

        finally:
            # Always delete the temp object, regardless of success or failure.
            try:
                self._s3.delete_object(Bucket=self._bucket, Key=s3_key)
                logger.debug("Deleted temp S3 object: %s", s3_key)
            except Exception as exc:
                logger.warning(
                    "Failed to delete temp S3 object %s: %s", s3_key, exc
                )

    def _poll_job(
        self, job_id: str, timeout_seconds: int = 300
    ) -> list[dict]:
        """
        Poll get_document_analysis until SUCCEEDED or FAILED (max 5 min).

        Handles paginated responses (NextToken) so all blocks are returned
        even for documents that produce thousands of Textract blocks.
        """
        deadline = time.monotonic() + timeout_seconds

        while True:
            if time.monotonic() > deadline:
                raise OCRFailedError(
                    f"Textract job {job_id} timed out after {timeout_seconds}s"
                )

            response = self._textract.get_document_analysis(JobId=job_id)
            status = response["JobStatus"]

            if status == "FAILED":
                raise OCRFailedError(
                    f"Textract job {job_id} failed: "
                    f"{response.get('StatusMessage', 'unknown reason')}"
                )

            if status == "SUCCEEDED":
                all_blocks: list[dict] = list(response.get("Blocks", []))
                next_token = response.get("NextToken")
                while next_token:
                    page = self._textract.get_document_analysis(
                        JobId=job_id, NextToken=next_token
                    )
                    all_blocks.extend(page.get("Blocks", []))
                    next_token = page.get("NextToken")
                logger.info(
                    "Textract job %s succeeded: %d blocks", job_id, len(all_blocks)
                )
                return all_blocks

            # IN_PROGRESS — wait before next poll
            time.sleep(5)

    # ── Block parsing ──────────────────────────────────────────────────────────

    def _parse_blocks(
        self,
        blocks: list[dict],
        page_count: int | None = None,
    ) -> OCRResult:
        block_map: dict[str, dict] = {b["Id"]: b for b in blocks}
        inferred_pages = max((b.get("Page", 1) for b in blocks), default=1)
        lines = [
            b["Text"] for b in blocks if b["BlockType"] == "LINE" and "Text" in b
        ]
        return OCRResult(
            full_text="\n".join(lines),
            pages=page_count if page_count is not None else inferred_pages,
            confidence=self._mean_confidence(blocks),
            tables=self._extract_tables(blocks, block_map),
            key_values=self._extract_key_values(blocks, block_map),
            sections=self._extract_sections(blocks),
        )

    # ── Table extraction ───────────────────────────────────────────────────────

    @staticmethod
    def _cell_text(cell: dict, block_map: dict[str, dict]) -> str:
        """Reconstruct the visible text of a CELL block from its WORD children."""
        words: list[str] = []
        for rel in cell.get("Relationships", []):
            if rel["Type"] != "CHILD":
                continue
            for wid in rel["Ids"]:
                word = block_map.get(wid)
                if word and word["BlockType"] == "WORD":
                    words.append(word.get("Text", ""))
        return " ".join(words)

    def _extract_tables(
        self, blocks: list[dict], block_map: dict[str, dict]
    ) -> list[dict]:
        tables: list[dict] = []
        for table in (b for b in blocks if b["BlockType"] == "TABLE"):
            cells: dict[tuple[int, int], str] = {}
            max_row = max_col = 0

            for rel in table.get("Relationships", []):
                if rel["Type"] != "CHILD":
                    continue
                for cid in rel["Ids"]:
                    cell = block_map.get(cid)
                    if not cell or cell["BlockType"] != "CELL":
                        continue
                    r, c = cell["RowIndex"], cell["ColumnIndex"]
                    max_row = max(max_row, r)
                    max_col = max(max_col, c)
                    cells[(r, c)] = self._cell_text(cell, block_map)

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

            tables.append({
                "headers": headers,
                "rows": rows,
                "page": table.get("Page", 1),
            })
        return tables

    # ── Key-value extraction ───────────────────────────────────────────────────

    @staticmethod
    def _kv_text(block: dict, block_map: dict[str, dict]) -> str:
        """Reconstruct text from a KEY_VALUE_SET block's WORD/SELECTION children."""
        words: list[str] = []
        for rel in block.get("Relationships", []):
            if rel["Type"] != "CHILD":
                continue
            for wid in rel["Ids"]:
                word = block_map.get(wid)
                if not word:
                    continue
                if word["BlockType"] == "WORD":
                    words.append(word.get("Text", ""))
                elif word["BlockType"] == "SELECTION_ELEMENT":
                    words.append(
                        "SELECTED"
                        if word.get("SelectionStatus") == "SELECTED"
                        else "NOT_SELECTED"
                    )
        return " ".join(words).strip()

    def _extract_key_values(
        self, blocks: list[dict], block_map: dict[str, dict]
    ) -> dict[str, str]:
        kv: dict[str, str] = {}
        for key_block in blocks:
            if key_block["BlockType"] != "KEY_VALUE_SET":
                continue
            if "KEY" not in key_block.get("EntityTypes", []):
                continue
            confidence = (key_block.get("Confidence") or 0.0) / 100.0
            if confidence < 0.5:
                continue

            key_text = self._kv_text(key_block, block_map)
            value_text = ""
            for rel in key_block.get("Relationships", []):
                if rel["Type"] != "VALUE":
                    continue
                for vid in rel["Ids"]:
                    val_block = block_map.get(vid)
                    if val_block:
                        value_text = self._kv_text(val_block, block_map)

            if key_text and value_text:
                kv[key_text] = value_text
        return kv

    # ── Section / confidence helpers ───────────────────────────────────────────

    @staticmethod
    def _extract_sections(blocks: list[dict]) -> dict[str, str]:
        pages: dict[str, list[str]] = {}
        for block in blocks:
            if block["BlockType"] == "LINE" and "Text" in block:
                key = f"Page {block.get('Page', 1)}"
                pages.setdefault(key, []).append(block["Text"])
        return {k: " ".join(v) for k, v in pages.items()}

    @staticmethod
    def _mean_confidence(blocks: list[dict]) -> float:
        scores = [
            b["Confidence"] / 100.0
            for b in blocks
            if b["BlockType"] == "WORD" and "Confidence" in b
        ]
        return round(sum(scores) / len(scores), 4) if scores else 0.9
