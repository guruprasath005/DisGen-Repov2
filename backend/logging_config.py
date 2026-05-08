"""
PHI scrubbing for all log output.

Installs a filter on every logging Handler — existing and future — so no PHI
ever reaches a log sink regardless of which logger emits it.

Approach: monkey-patch logging.Handler.__init__ so every handler created after
setup_logging() is called automatically gets the PHI filter. Also retroactively
adds the filter to handlers that already exist at call time.

Patterns scrubbed:
  - ABHA ID:       XX-XXXX-XXXX-XXXX
  - Aadhaar:       12-digit blocks
  - Indian phone:  10 digits starting with 6–9
  - UHID:          U/uhid prefix + digits
  - Age+gender:    "45yr", "30M", "28 Female"
  - ICD-10 codes:  A00–Z99 with optional decimal
"""

import logging
import re
from typing import ClassVar


class PHIScrubFilter(logging.Filter):
    _PATTERNS: ClassVar[list[tuple[re.Pattern, str]]] = [
        # ABHA ID: XX-XXXX-XXXX-XXXX
        (re.compile(r"\b\d{2}-\d{4}-\d{4}-\d{4}\b"), "[REDACTED-ABHA]"),
        # Aadhaar: 12 digits (with optional spaces or dashes between groups of 4)
        (re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b"), "[REDACTED-AADHAAR]"),
        # Indian mobile: 10 digits starting with 6–9
        (re.compile(r"\b[6-9]\d{9}\b"), "[REDACTED-PHONE]"),
        # UHID patterns
        (re.compile(r"\b[Uu][Hh][Ii][Dd][-/]?\d+\b"), "[REDACTED-UHID]"),
        (re.compile(r"\bU\d{6,12}\b"), "[REDACTED-UHID]"),
        # Age + gender adjacency
        (re.compile(r"\b\d{1,3}\s*(?:yr|year|years?|M|F|male|female)\b", re.IGNORECASE), "[REDACTED-DEMOG]"),
        # ICD-10: letter + 2 digits + optional decimal + 1–2 digits
        (re.compile(r"\b[A-Z]\d{2}(?:\.\d{1,2})?\b"), "[REDACTED-ICD10]"),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._scrub(str(record.msg))
        record.args = self._scrub_args(record.args)
        return True

    def _scrub(self, text: str) -> str:
        for pattern, replacement in self._PATTERNS:
            text = pattern.sub(replacement, text)
        return text

    def _scrub_args(self, args):
        if args is None:
            return args
        if isinstance(args, dict):
            return {k: self._scrub(str(v)) if isinstance(v, str) else v for k, v in args.items()}
        if isinstance(args, (list, tuple)):
            return type(args)(self._scrub(str(a)) if isinstance(a, str) else a for a in args)
        return args


def setup_logging() -> None:
    """
    Install PHI scrubbing on all log handlers — existing and future.
    Call exactly once at application startup.
    """
    phi_filter = PHIScrubFilter()

    # ── Patch Handler.__init__ so every future handler auto-gets the filter ──
    _orig_handler_init = logging.Handler.__init__

    def _patched_handler_init(self, level=logging.NOTSET):
        _orig_handler_init(self, level)
        if not any(isinstance(f, PHIScrubFilter) for f in self.filters):
            self.addFilter(phi_filter)

    logging.Handler.__init__ = _patched_handler_init  # type: ignore[method-assign]

    # ── Retroactively add to all handlers already created ────────────────────
    for handler in logging.root.handlers:
        if not any(isinstance(f, PHIScrubFilter) for f in handler.filters):
            handler.addFilter(phi_filter)

    for logger in logging.Logger.manager.loggerDict.values():
        if isinstance(logger, logging.Logger):
            for handler in logger.handlers:
                if not any(isinstance(f, PHIScrubFilter) for f in handler.filters):
                    handler.addFilter(phi_filter)

    logging.getLogger(__name__).info("PHI scrubbing filter active on all log handlers")
