"""Contexte tenant (workspace + utilisateur) propagé par requête."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal

Role = Literal["admin", "member", "subscriber"]
OPERATOR_ROLES: frozenset[str] = frozenset({"admin", "member"})
ALL_ROLES: frozenset[str] = frozenset({"admin", "member", "subscriber"})
SUBSCRIBER_PATH_PREFIXES: tuple[str, ...] = ("/auth", "/subscriber")


def normalize_role(role: str | None) -> Role:
    raw = (role or "member").strip()
    if raw in ALL_ROLES:
        return raw  # type: ignore[return-value]
    return "member"


def is_operator_role(role: str | None) -> bool:
    return normalize_role(role) in OPERATOR_ROLES


def subscriber_path_allowed(path: str) -> bool:
    p = path or ""
    return any(p == prefix or p.startswith(f"{prefix}/") for prefix in SUBSCRIBER_PATH_PREFIXES)

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
