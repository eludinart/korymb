"""Contexte tenant (workspace + utilisateur) propagé par requête."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal

Role = Literal["admin", "member"]

_current_workspace_id: ContextVar[str | None] = ContextVar("workspace_id", default=None)
_current_user_id: ContextVar[str | None] = ContextVar("user_id", default=None)
_current_role: ContextVar[Role | None] = ContextVar("role", default=None)


@dataclass(frozen=True)
class TenantContext:
    workspace_id: str
    user_id: str | None = None
    role: Role | None = None


def set_tenant_context(
    *,
    workspace_id: str,
    user_id: str | None = None,
    role: Role | None = None,
) -> None:
    _current_workspace_id.set(workspace_id)
    _current_user_id.set(user_id)
    _current_role.set(role)


def clear_tenant_context() -> None:
    _current_workspace_id.set(None)
    _current_user_id.set(None)
    _current_role.set(None)


def get_workspace_id() -> str | None:
    return _current_workspace_id.get()


def get_user_id() -> str | None:
    return _current_user_id.get()


def get_role() -> Role | None:
    return _current_role.get()


def get_tenant_context() -> TenantContext | None:
    ws = get_workspace_id()
    if not ws:
        return None
    return TenantContext(workspace_id=ws, user_id=get_user_id(), role=get_role())
