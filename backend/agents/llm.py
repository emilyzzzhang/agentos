"""Claude integration via LangChain (langchain-anthropic).

Agents depend on the small `StructuredLLM` protocol, so tests and the labeled
demo mode can substitute a scripted implementation without touching agent code.
"""
from __future__ import annotations

import logging
from typing import Protocol, TypeVar

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from config import Effort, Settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    """Raised when Claude fails, refuses, or returns output that does not match the schema."""


class StructuredLLM(Protocol):
    async def generate(self, *, agent_id: str, schema: type[T], system: str, prompt: str, effort: Effort) -> T: ...


class ClaudeStructuredLLM:
    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set. Add it to backend/.env.")
        self.settings = settings
        self._use_fallback = settings.refusal_fallback

    def _model(self, effort: Effort) -> ChatAnthropic:
        kwargs: dict = {}
        if self._use_fallback:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["model_kwargs"] = {"fallbacks": "default"}
        return ChatAnthropic(
            model=self.settings.model,
            api_key=self.settings.anthropic_api_key,
            max_tokens=self.settings.llm_max_tokens,
            timeout=self.settings.llm_timeout_s,
            max_retries=2,
            effort=effort,
            # Thinking stays adaptive; we only need the final structured answer.
            thinking={"type": "adaptive"},
            **kwargs,
        )

    async def generate(self, *, agent_id: str, schema: type[T], system: str, prompt: str, effort: Effort) -> T:
        try:
            return await self._generate_once(schema, system, prompt, effort)
        except Exception as exc:  # noqa: BLE001 - narrowed below
            if self._use_fallback and "fallback" in str(exc).lower():
                log.warning("Refusal fallback rejected by API (%s); retrying without it.", exc)
                self._use_fallback = False
                return await self._generate_once(schema, system, prompt, effort)
            if isinstance(exc, LLMError):
                raise
            raise LLMError(f"{agent_id}: Claude request failed: {type(exc).__name__}: {exc}") from exc

    async def _generate_once(self, schema: type[T], system: str, prompt: str, effort: Effort) -> T:
        runnable = self._model(effort).with_structured_output(schema, method="json_schema", include_raw=True)
        result = await runnable.ainvoke([SystemMessage(content=system), HumanMessage(content=prompt)])
        raw = result.get("raw")
        stop_reason = getattr(raw, "response_metadata", {}).get("stop_reason") if raw is not None else None
        if stop_reason == "refusal":
            raise LLMError("Claude declined this request (stop_reason=refusal).")
        if stop_reason == "max_tokens":
            raise LLMError("Claude response was truncated (max_tokens). Try a narrower question.")
        if result.get("parsing_error") is not None or result.get("parsed") is None:
            raise LLMError(f"Claude output did not match {schema.__name__}: {result.get('parsing_error')}")
        parsed = result["parsed"]
        return parsed if isinstance(parsed, schema) else schema.model_validate(parsed)
