"""
spaCy NER-based clinical extraction — secondary NLP fallback.

Loaded lazily on first call. If the model is not installed (e.g., missing
en_core_web_sm download), the function degrades gracefully to an empty result.

Disabled components: tagger, parser, attribute_ruler, lemmatizer — only NER
is needed, so we skip the pipeline stages that are not required. This reduces
load time and memory footprint in the Celery worker.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_nlp: Any = None  # spacy.Language | None
_load_attempted: bool = False


def _get_nlp() -> Any:
    global _nlp, _load_attempted
    if _load_attempted:
        return _nlp
    _load_attempted = True
    try:
        import spacy  # noqa: PLC0415

        _nlp = spacy.load(
            "en_core_web_sm",
            disable=["tagger", "parser", "attribute_ruler", "lemmatizer"],
        )
        logger.info("spaCy en_core_web_sm loaded for NLP fallback")
    except OSError:
        logger.warning(
            "spaCy model en_core_web_sm not found — "
            "NLP fallback will use regex only"
        )
        _nlp = None
    return _nlp


# ── Public API ─────────────────────────────────────────────────────────────────

# Limit text length sent to spaCy to avoid OOM in long clinical documents.
_NLP_TEXT_LIMIT = 12_000


def extract_from_text(text: str) -> dict:
    """
    Use spaCy NER to extract person names and dates from OCR text.

    Returns a dict with discovered values. Keys:
      patient_name         — first PERSON entity in document
      date_candidates_nlp  — up to 5 DATE entities (may overlap with regex dates)
    """
    nlp = _get_nlp()
    if nlp is None:
        return {}

    result: dict = {}
    doc = nlp(text[:_NLP_TEXT_LIMIT])

    # First PERSON entity is almost always the patient name in an Indian
    # discharge summary (appears near the top: Name: Dr. / Mr. / Ms. ...)
    persons = [
        ent.text.strip()
        for ent in doc.ents
        if ent.label_ == "PERSON" and len(ent.text.strip()) > 2
    ]
    if persons:
        result["patient_name"] = persons[0]

    dates = [
        ent.text.strip()
        for ent in doc.ents
        if ent.label_ == "DATE" and ent.text.strip()
    ]
    if dates:
        result["date_candidates_nlp"] = dates[:5]

    return result
