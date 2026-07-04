"""Compatibilité auth — délègue à services.workspace_auth."""
from __future__ import annotations

from services.workspace_auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    login_user,
    register_user,
    require_admin,
    resolve_tenant,
    verify_password,
    verify_secret,
)

__all__ = [
    "create_access_token",
    "decode_access_token",
    "hash_password",
    "login_user",
    "register_user",
    "require_admin",
    "resolve_tenant",
    "verify_password",
    "verify_secret",
]
