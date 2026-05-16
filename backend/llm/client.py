"""
LLM client façade.

Thin, stable wrapper over the pluggable provider seam in ``llm/provider.py``.
Callers (extractor, generator) keep importing ``LLMClient`` and never see a
vendor SDK. Swapping OpenAI for a DPDP-compliant in-India provider is a config
change (``LLM_PROVIDER``), not a code change here.

Each Celery worker process gets its own singleton (created lazily after fork —
SDK clients are thread-safe but not fork-safe).
"""

from __future__ import annotations

import logging
from typing import ClassVar

from llm.provider import LLMProvider, build_provider

logger = logging.getLogger(__name__)


class LLMClient:
    _instance: ClassVar[LLMClient | None] = None

    def __init__(self) -> None:
        self._provider: LLMProvider = build_provider()
        logger.info(
            "LLMClient ready (provider=%s, data_residency=%s)",
            self._provider.name,
            self._provider.data_residency,
        )

    @classmethod
    def get_instance(cls) -> LLMClient:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def provider(self) -> LLMProvider:
        return self._provider

    def chat(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> str:
        """Chat completion returning only the content (legacy signature)."""
        content, _ = self._provider.chat(
            messages,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            json_mode=json_mode,
        )
        return content

    def chat_with_finish(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> tuple[str, str]:
        """
        Chat completion returning ``(content, finish_reason)``.

        ``finish_reason == "length"`` signals the output was truncated.
        Used by the long-document extractor to split-and-retry instead of
        silently repairing truncated JSON and losing clinical data.
        """
        return self._provider.chat(
            messages,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            json_mode=json_mode,
        )

    def chat_with_tool(
        self,
        messages: list[dict],
        *,
        tool_name: str,
        tool_description: str,
        tool_input_schema: dict,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        system: str | None = None,
    ) -> dict:
        """Forced tool/function call. Returns the parsed tool-input dict."""
        return self._provider.chat_with_tool(
            messages,
            tool_name=tool_name,
            tool_description=tool_description,
            tool_input_schema=tool_input_schema,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            system=system,
        )
