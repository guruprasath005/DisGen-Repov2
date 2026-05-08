"""
Discharge summary PDF renderer.

Pipeline (field-based, new workflow)
─────────────────────────────────────
  summary_fields dict  ─►  Jinja2 template  ─►  WeasyPrint  ─►  PDF bytes
  (each field rendered as a labeled row; null values shown as "—")

Pipeline (legacy free-text fallback)
─────────────────────────────────────
  Markdown summary_text  ─►  HTML via `markdown` lib  ─►  same path above

Templates live in `backend/pdf/templates/` and all extend `base.html`. The
scheme picks its own template via `Scheme.pdf_template` (e.g. `pmjay.html`);
unknown values fall back to `custom.html`.

This module is pure and synchronous — it takes ORM objects in, returns bytes
out. No DB writes, no FS writes (Jinja's FileSystemLoader caches templates
on first access). Call from a thread inside async code if needed.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import markdown as md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape
from weasyprint import HTML

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent / "templates"

_VALID_TEMPLATES: frozenset[str] = frozenset(
    {"base.html", "pmjay.html", "cghs.html", "esi.html", "cmchis.html",
     "private.html", "custom.html", "complete.html"}
)

# Single Jinja Environment per process. autoescape on every .html so any user
# string rendered without `| safe` is escaped — protects against HTML injection
# from doctor edits or scheme labels. Markdown→HTML output is the one explicit
# `| safe` pass and it goes through `_markdown_to_html` which is itself safe
# because the Markdown library escapes unknown HTML.
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(enabled_extensions=("html", "xml"), default=True),
    trim_blocks=True,
    lstrip_blocks=True,
)


# ── Jinja filters ─────────────────────────────────────────────────────────────


def _field_display(val: Any) -> Markup:
    """
    Format a summary_fields value for HTML rendering.

    Returns a Markup (safe) string:
    - str  : newlines converted to <br>
    - list : each item on its own line; dicts formatted as "k: v" pairs
    - dict : "k: v" per key, one per line
    - None / "" : empty Markup (template renders "—" placeholder)
    """
    if val is None:
        return Markup("")
    if isinstance(val, str):
        text = val.strip()
        if not text:
            return Markup("")
        return Markup(escape(text).replace("\n", Markup("<br>")))
    if isinstance(val, list):
        if not val:
            return Markup("")
        lines: list[str] = []
        for item in val:
            if isinstance(item, dict):
                parts = [
                    f"{escape(str(k))}: {escape(str(v))}"
                    for k, v in item.items()
                    if v is not None and str(v).strip()
                ]
                lines.append(", ".join(parts))
            else:
                lines.append(str(escape(str(item))))
        return Markup("<br>".join(l for l in lines if l))
    if isinstance(val, dict):
        if not val:
            return Markup("")
        parts = [
            f"{escape(str(k))}: {escape(str(v))}"
            for k, v in val.items()
            if v is not None and str(v).strip()
        ]
        return Markup("<br>".join(parts))
    return Markup(escape(str(val)))


_env.filters["field_display"] = _field_display


# ── Markdown → HTML (legacy free-text fallback) ───────────────────────────────


_MARKDOWN_EXTENSIONS = ("extra", "sane_lists", "nl2br")


def _markdown_to_html(text: str) -> str:
    """Render Markdown to HTML for the legacy free-text summary path."""
    return md.markdown(text or "", extensions=list(_MARKDOWN_EXTENSIONS), output_format="html")


def _resolve_template_name(scheme_template: str | None) -> str:
    """Pick a template name, defaulting to custom.html when unknown / missing."""
    if scheme_template and scheme_template in _VALID_TEMPLATES:
        return scheme_template
    return "custom.html"


# ── Field-definition helpers ──────────────────────────────────────────────────


def _build_ordered_field_defs(
    scheme,
) -> tuple[list[dict], list[dict]]:
    """
    Return (required_metas, optional_metas) as ordered lists of field metadata dicts.

    Each dict: {field, label, type, section, hint}
    Accepts fields in either shape:
      - str  — key=label, type="string", section="", hint=""
      - dict — {"field"|"name", "label", "type"?, "section"?, "hint"?}
    """
    def _parse(f: Any) -> dict | None:
        if isinstance(f, dict):
            name = (f.get("field") or f.get("name") or "").strip()
            label = (f.get("label") or "").strip() or name.replace("_", " ").title()
            ftype = (f.get("type") or "string").strip() or "string"
            section = (f.get("section") or "").strip()
            hint = (f.get("hint") or "").strip()
        elif isinstance(f, str):
            name = f.strip()
            label = name.replace("_", " ").title()
            ftype = "string"
            section = ""
            hint = ""
        else:
            return None
        if not name:
            return None
        return {"field": name, "label": label, "type": ftype, "section": section, "hint": hint}

    req_raw = getattr(scheme, "required_fields", None) or []
    opt_raw = getattr(scheme, "optional_fields", None) or []
    required_metas = [d for f in req_raw if (d := _parse(f)) is not None]
    optional_metas = [d for f in opt_raw if (d := _parse(f)) is not None]
    return required_metas, optional_metas


# ── Helpers ───────────────────────────────────────────────────────────────────


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(*parts: str) -> str:
    """Produce a Content-Disposition-safe ASCII filename."""
    base = "_".join(p for p in parts if p)
    base = _FILENAME_SAFE.sub("_", base).strip("_") or "discharge_summary"
    return f"{base[:120]}.pdf"


def _format_dt(dt: Any) -> str:
    if dt is None:
        return ""
    try:
        return dt.strftime("%d-%b-%Y %H:%M")
    except Exception:
        return str(dt)


# ── Public API ────────────────────────────────────────────────────────────────


def render_pdf(
    *,
    summary_fields: dict | None = None,   # field-based workflow (new)
    summary_text: str | None = None,      # legacy free-text (old summaries)
    structured_data: dict,
    scheme,             # models.scheme.Scheme
    document,           # models.document.Document
    summary,            # models.scheme.GeneratedSummary
    hospital_config,    # models.compliance.HospitalConfig
    generated_by_name: str,
    approved_by_name: str | None = None,
) -> bytes:
    """Render a discharge summary to PDF bytes.

    Field-based path (new): each summary_fields entry is rendered as a labeled
    row in a table. Null or missing values show "—" so the PDF never has gaps.

    Legacy path (old summaries): summary_text is rendered as Markdown when
    summary_fields is not present. Both paths share the same template/CSS.

    Caller supplies all materialised ORM objects — keeps this module easy to
    unit-test (no DB session) and safe to call from any process.
    """
    template_name = _resolve_template_name(getattr(scheme, "pdf_template", None))
    template = _env.get_template(template_name)

    required_field_metas, optional_field_metas = _build_ordered_field_defs(scheme)

    # Legacy-compat tuples for builtin templates that still unpack (field, label)
    required_field_defs = [(m["field"], m["label"]) for m in required_field_metas]
    optional_field_defs = [(m["field"], m["label"]) for m in optional_field_metas]

    # Legacy free-text path: convert Markdown → HTML only when needed.
    summary_html = _markdown_to_html(summary_text) if summary_text else ""

    # sf is always a plain dict passed to templates for .get() safety.
    sf: dict = summary_fields if isinstance(summary_fields, dict) else {}

    rendered_html = template.render(
        # Field-based rendering (full metadata for smart templates)
        summary_fields=summary_fields,        # None for legacy rows
        sf=sf,                                 # always a dict — safe .get()
        required_field_metas=required_field_metas,
        optional_field_metas=optional_field_metas,
        # Legacy-compat tuples for builtin templates
        required_field_defs=required_field_defs,
        optional_field_defs=optional_field_defs,
        # Legacy free-text rendering (empty string when not applicable)
        summary_html=summary_html,
        # Context
        structured_data=structured_data or {},
        scheme=scheme,
        document=document,
        summary=summary,
        hospital_config=hospital_config,
        generated_by_name=generated_by_name,
        approved_by_name=approved_by_name,
        generated_at=_format_dt(getattr(summary, "created_at", None)),
        approved_at=_format_dt(getattr(summary, "approved_at", None)),
        is_draft=(getattr(summary, "status", None) != "approved"),
    )

    pdf_bytes = HTML(
        string=rendered_html,
        base_url=str(_TEMPLATE_DIR),
    ).write_pdf()

    logger.info(
        "PDF rendered document=%s scheme=%s template=%s bytes=%d",
        getattr(document, "id", "?"),
        getattr(scheme, "id", "?"),
        template_name,
        len(pdf_bytes or b""),
    )
    return pdf_bytes


def safe_pdf_filename(structured_data: dict | None, scheme_id: str, version: int) -> str:
    """
    Compose an attachment-safe filename for a downloaded summary PDF.
    Strips non-ASCII characters from the patient name to keep the
    Content-Disposition header simple and RFC-clean.
    """
    name = ""
    if structured_data and isinstance(structured_data.get("patient_name"), str):
        name = structured_data["patient_name"]
    return _safe_filename("discharge_summary", name, scheme_id, f"v{version}")
