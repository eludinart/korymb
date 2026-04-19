"""Contexte optionnel pour rattacher les appels LLM à un job / un libellé (usage_events)."""
from __future__ import annotations

from contextvars import ContextVar
from contextlib import contextmanager
from typing import Iterator

_job_id: ContextVar[str | None] = ContextVar("llm_usage_job_id", default=None)
_context_label: ContextVar[str] = ContextVar("llm_usage_context_label", default="")


def get_usage_job_id() -> str | None:
    return _job_id.get()


def get_usage_context_label() -> str:
    return _context_label.get() or ""


@contextmanager
def usage_llm_scope(job_id: str | None, label: str = "") -> Iterator[None]:
    t_job = _job_id.set(job_id)
    t_lab = _context_label.set((label or "")[:80])
    try:
        yield
    finally:
        _job_id.reset(t_job)
        _context_label.reset(t_lab)
