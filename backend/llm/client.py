"""
OpenAI GPT-4o mini LLM client.

Replaces AWS Bedrock for development use. Switch back to Bedrock for
production deployment to restore DPDP data-residency compliance
(patient data must stay in India — ap-south-1 Mumbai).

Never instantiate directly; always use LLMClient.get_instance().
"""

from __future__ import annotations

import json
import logging
from typing import Any, ClassVar

from openai import OpenAI
from openai import APIError, APIConnectionError, RateLimitError

from config import settings

logger = logging.getLogger(__name__)


class LLMClient:
    """
    Singleton wrapper around the OpenAI Chat Completions API.

    Each Celery worker process gets its own singleton via the class var.
    OpenAI client is thread-safe but not fork-safe; the singleton is
    created lazily inside the worker after fork.
    """

    _instance: ClassVar[LLMClient | None] = None

    def __init__(self) -> None:
        self._client = OpenAI(api_key=settings.openai_api_key)
        self._model_id = settings.openai_model_id
        logger.info("LLMClient initialised (model=%s)", self._model_id)

    @classmethod
    def get_instance(cls) -> LLMClient:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def chat(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        top_p: float = 1.0,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> str:
        """
        Call OpenAI Chat Completions and return the response text.

        Accepts OpenAI-style messages (role/content dicts) directly.
        json_mode=True uses response_format json_object for strict JSON output.

        temperature=0.0 for deterministic clinical output.

        Raises openai.APIError on API failures.
        """
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
        return response.choices[0].message.content or ""

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
        """
        Call OpenAI with forced function/tool use and return the parsed tool
        input dict.

        tool_choice forces the model to call exactly the named function,
        guaranteeing the response populates the JSON schema. This mirrors
        the previous Bedrock toolChoice behaviour.

        Raises:
          ValueError — model response did not contain the expected tool call.
          openai.APIError — OpenAI API error.
        """
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
            f"OpenAI response did not contain expected tool call for "
            f"'{tool_name}'. finish_reason={response.choices[0].finish_reason}"
        )
