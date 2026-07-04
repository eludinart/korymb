"""Authentification utilisateurs — JWT, mots de passe, contexte tenant."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from tenant_context import Role, clear_tenant_context, set_tenant_context
from workspace_db import (
    _DEFAULT_WORKSPACE_ID,
    add_member,
    create_user,
    create_workspace,
    get_membership,
    get_user_by_email,
    get_user_by_id,
    get_workspace_by_id,
    list_user_workspaces,
    list_workspace_members,
)

logger = logging.getLogger(__name__)

api_key_header = APIKeyHeader(name="X-Agent-Secret", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

JWT_ALGORITHM = "HS256"


def _jwt_secret() -> str:
    secret = (settings.jwt_secret or "").strip()
    return secret or settings.agent_api_secret


def hash_password(password: str) -> str:
    pwd = (password or "").encode("utf-8")
    if len(pwd) < 8:
        raise ValueError("Le mot de passe doit contenir au moins 8 caractères.")
    return bcrypt.hashpw(pwd, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw((password or "").encode("utf-8"), (password_hash or "").encode("utf-8"))
    except Exception:
        return False


def create_access_token(*, user_id: str, workspace_id: str, role: Role) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=max(1, int(settings.jwt_expire_hours)))
    payload = {
        "sub": user_id,
        "ws": workspace_id,
        "role": role,
        "exp": exp,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        data = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
        if not isinstance(data, dict):
            raise HTTPException(status_code=401, detail="Token invalide.")
        return data
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session expirée — reconnectez-vous.") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Token invalide.") from exc


def register_user(*, email: str, password: str, display_name: str = "", workspace_name: str = "") -> dict[str, Any]:
    mail = email.strip().lower()
    if not mail or "@" not in mail:
        raise ValueError("E-mail invalide.")
    if get_user_by_email(mail):
        raise ValueError("Un compte existe déjà avec cet e-mail.")
    user = create_user(mail, hash_password(password), display_name)
    ws_name = (workspace_name or display_name or mail.split("@")[0] or "Mon Korymb").strip()
    workspace = create_workspace(ws_name, user["id"])
    token = create_access_token(user_id=user["id"], workspace_id=workspace["id"], role="admin")
    return {
        "token": token,
        "user": get_user_by_id(user["id"]),
        "workspace": workspace,
        "role": "admin",
    }


def login_user(*, email: str, password: str, workspace_id: str | None = None) -> dict[str, Any]:
    mail = email.strip().lower()
    row = get_user_by_email(mail)
    if not row or not verify_password(password, str(row.get("password_hash") or "")):
        raise ValueError("E-mail ou mot de passe incorrect.")
    user = get_user_by_id(row["id"])
    workspaces = list_user_workspaces(row["id"])
    if not workspaces:
        workspace = create_workspace("Mon Korymb", row["id"])
        workspaces = [workspace]
    target_ws = (workspace_id or "").strip()
    chosen = None
    if target_ws:
        chosen = next((w for w in workspaces if w["id"] == target_ws), None)
        if not chosen:
            raise ValueError("Vous n'avez pas accès à cet espace Korymb.")
    else:
        chosen = workspaces[0]
    role = str(chosen.get("role") or "member")
    if role not in ("admin", "member"):
        role = "member"
    token = create_access_token(user_id=row["id"], workspace_id=chosen["id"], role=role)  # type: ignore[arg-type]
    return {
        "token": token,
        "user": user,
        "workspace": get_workspace_by_id(chosen["id"]),
        "workspaces": workspaces,
        "role": role,
    }


def _resolve_workspace_from_request(
    request: Request,
    token_payload: dict[str, Any] | None,
) -> tuple[str, str | None, Role | None]:
    header_ws = (request.headers.get("X-Workspace-Id") or "").strip()
    if token_payload:
        user_id = str(token_payload.get("sub") or "")
        ws = header_ws or str(token_payload.get("ws") or "")
        if not ws:
            workspaces = list_user_workspaces(user_id)
            ws = workspaces[0]["id"] if workspaces else _DEFAULT_WORKSPACE_ID
        membership = get_membership(ws, user_id)
        if not membership:
            raise HTTPException(status_code=403, detail="Accès refusé à cet espace Korymb.")
        role = str(membership.get("role") or "member")
        if role not in ("admin", "member"):
            role = "member"
        return ws, user_id, role  # type: ignore[return-value]
    return _DEFAULT_WORKSPACE_ID, None, None


def verify_secret(key: str | None = Depends(api_key_header)) -> str:
    if key and key == settings.agent_api_secret:
        return key
    raise HTTPException(status_code=403, detail="Secret invalide.")


async def resolve_tenant(
    request: Request,
    secret: str | None = Depends(api_key_header),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """
    Authentifie la requête via JWT utilisateur ou secret agent (legacy/tests).
    Pose le contexte tenant pour le reste de la requête.
    """
    token_payload: dict[str, Any] | None = None
    auth_header = request.headers.get("Authorization") or ""
    raw_token = ""
    if creds and creds.credentials:
        raw_token = creds.credentials.strip()
    elif auth_header.lower().startswith("bearer "):
        raw_token = auth_header[7:].strip()

    if raw_token:
        token_payload = decode_access_token(raw_token)
    elif secret and secret == settings.agent_api_secret:
        clear_tenant_context()
        set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
        return {"mode": "agent_secret", "workspace_id": _DEFAULT_WORKSPACE_ID}
    else:
        raise HTTPException(status_code=401, detail="Authentification requise.")

    ws_id, user_id, role = _resolve_workspace_from_request(request, token_payload)
    set_tenant_context(workspace_id=ws_id, user_id=user_id, role=role)
    return {
        "mode": "user",
        "user_id": user_id,
        "workspace_id": ws_id,
        "role": role,
    }


async def require_admin(auth: dict[str, Any] = Depends(resolve_tenant)) -> dict[str, Any]:
    if auth.get("mode") == "agent_secret":
        return auth
    if auth.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Droits administrateur requis pour cette action.")
    return auth


def get_auth_profile(user_id: str, workspace_id: str) -> dict[str, Any]:
    user = get_user_by_id(user_id)
    workspace = get_workspace_by_id(workspace_id)
    membership = get_membership(workspace_id, user_id)
    workspaces = list_user_workspaces(user_id)
    members = list_workspace_members(workspace_id) if membership else []
    role = str((membership or {}).get("role") or "member")
    return {
        "user": user,
        "workspace": workspace,
        "workspaces": workspaces,
        "members": members,
        "role": role,
    }
