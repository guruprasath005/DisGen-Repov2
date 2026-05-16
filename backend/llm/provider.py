"""
LLM provider seam.

The whole LLM layer talks to this interface, never to a vendor SDK directly.
Today the only implementation is OpenAI (US). For the Delhi hospital this means
patient PHI leaves India — a known DPDP Act exposure that the hospital has
agreed to resolve *after* this review by switching providers.

Because of this seam that switch is a configuration change, not a rewrite:
add an ``AzureOpenAIProvider`` (Central India) here, set ``LLM_PROVIDER`` in
``.env``, done. Each provider also declares its ``data_residency`` so the app
can refuse to stay silent about a non-compliant configuration (see
``main.py`` startup guard and ``/health``).

Synchronous by design — callers run these from ``asyncio.to_thread()``.
"""

from __future__ import annotations

import abc
import json
import logging
from typing import Any

from config import settings

logger = logging.getLogger(__name__)


class LLMProvider(abc.ABC):
    """Vendor-agnostic chat/tool interface used by extractor + generator."""

    #: Human-readable provider id, e.g. "openai", "azure_openai".
    name: str = "abstract"

    #: Where prompts (and therefore PHI) are processed.
    #: "in_india" is DPDP-compliant for an Indian hospital; anything else is not.
    data_residency: str = "unknown"

    @property
    def dpdp_compliant(self) -> bool:
        return self.data_residency == "in_india"

    @abc.abstractmethod
    def chat(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> tuple[str, str]:
        """
        Plain chat completion.

        Returns ``(content, finish_reason)``. ``finish_reason == "length"``
        means the output was truncated — callers (extraction) use this to
        split and retry instead of silently repairing truncated JSON.
        """

    @abc.abstractmethod
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


class OpenAIProvider(LLMProvider):
    """
    OpenAI Chat Completions implementation.

    ⚠️ data_residency = outside_india_us — prompts (patient PHI) are processed
    in the United States. NOT DPDP-compliant for a production Indian hospital.
    Acceptable only for this pre-approval review; swap before go-live.
    """

    name = "openai"
    data_residency = "outside_india_us"

    def __init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=settings.openai_api_key)
        self._model_id = settings.openai_model_id
        logger.info("OpenAIProvider initialised (model=%s)", self._model_id)

    def chat(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> tuple[str, str]:
        kwargs: dict[str, Any] = {
            "model": self._model_id,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = self._client.chat.completions.create(**kwargs)
        choice = response.choices[0]
        return choice.message.content or "", choice.finish_reason or "stop"

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
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(
            msg for msg in messages if msg.get("role") != "system"
        )

        response = self._client.chat.completions.create(
            model=self._model_id,
            messages=full_messages,
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_description,
                        "parameters": tool_input_schema,
                    },
                }
            ],
            tool_choice={"type": "function", "function": {"name": tool_name}},
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
        )

        message = response.choices[0].message
        if message.tool_calls:
            for tc in message.tool_calls:
                if tc.function.name == tool_name:
                    return json.loads(tc.function.arguments)

        raise ValueError(
            f"LLM response did not contain expected tool call for "
            f"'{tool_name}'. finish_reason={response.choices[0].finish_reason}"
        )


# ── Factory ───────────────────────────────────────────────────────────────────

_PROVIDERS: dict[str, type[LLMProvider]] = {
    "openai": OpenAIProvider,
    # Post-approval, DPDP-compliant target — add the class and register here:
    # "azure_openai": AzureOpenAIProvider,   # Azure OpenAI, Central India
}


def _configured_impl() -> type[LLMProvider]:
    key = (settings.llm_provider or "openai").strip().lower()
    impl = _PROVIDERS.get(key)
    if impl is None:
        raise RuntimeError(
            f"Unknown LLM_PROVIDER='{key}'. Known: {sorted(_PROVIDERS)}"
        )
    return impl


def build_provider() -> LLMProvider:
    """Instantiate the provider named by ``settings.llm_provider``."""
    return _configured_impl()()


def configured_residency() -> tuple[str, str, bool]:
    """
    ``(provider_name, data_residency, dpdp_compliant)`` for the configured
    provider WITHOUT instantiating an SDK client. Used by the startup guard
    and ``/health`` so a non-compliant config is impossible to miss.
    """
    impl = _configured_impl()
    return impl.name, impl.data_residency, impl.data_residency == "in_india"
