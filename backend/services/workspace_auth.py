"""Authentification utilisateurs — JWT, mots de passe, contexte tenant."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from tenant_context import (
    Role,
    clear_tenant_context,
    is_operator_role,
    normalize_role,
    set_tenant_context,
    subscriber_path_allowed,
)
from workspace_db import (
    _DEFAULT_WORKSPACE_ID,
    add_member,
    create_user,
    create_workspace,
    get_guest_membership_by_code,
    get_membership,
    get_user_by_email,
    get_user_by_id,
    get_workspace_by_id,
    get_workspace_by_slug,
    list_user_workspaces,
    list_workspace_operators,
    new_invite_code,
    normalize_participant_status,
    participant_is_active,
    serialize_participant,
    set_subscriber_status,
    set_user_password_hash,
    upsert_subscriber_membership,
    workspace_public_enabled,
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


def register_subscriber(*, email: str, password: str, display_name: str = "", workspace_slug: str) -> dict[str, Any]:
    """Demande d'inscription participant — en attente de validation du dirigeant."""
    mail = email.strip().lower()
    if not mail or "@" not in mail:
        raise ValueError("E-mail invalide.")
    workspace = get_workspace_by_slug(workspace_slug)
    if not workspace or not workspace_public_enabled(workspace):
        raise ValueError("Vitrine introuvable ou non publiée.")
    ws_id = str(workspace["id"])
    existing = get_user_by_email(mail)
    if existing:
        if not verify_password(password, str(existing.get("password_hash") or "")):
            raise ValueError("Un compte existe déjà avec cet e-mail — mot de passe incorrect.")
        user_id = str(existing["id"])
        membership = get_membership(ws_id, user_id)
        if membership:
            role = normalize_role(str(membership.get("role") or "subscriber"))
            status = normalize_participant_status(membership.get("status"), role=role)
        else:
            add_member(ws_id, mail, "subscriber", status="pending")
            role = "subscriber"
            status = "pending"
    else:
        user = create_user(mail, hash_password(password), display_name)
        user_id = str(user["id"])
        add_member(ws_id, mail, "subscriber", status="pending")
        role = "subscriber"
        status = "pending"
    token = create_access_token(user_id=user_id, workspace_id=ws_id, role=role)
    return {
        "token": token,
        "user": get_user_by_id(user_id),
        "workspace": {
            "id": workspace.get("id"),
            "name": workspace.get("name"),
            "slug": workspace.get("slug"),
        },
        "role": role,
        "membership_status": status,
    }


def invite_subscriber(
    *,
    workspace_id: str,
    email: str,
    display_name: str = "",
) -> dict[str, Any]:
    mail = (email or "").strip().lower()
    if not mail or "@" not in mail:
        raise ValueError("E-mail invalide.")
    workspace = get_workspace_by_id(workspace_id)
    if not workspace:
        raise ValueError("Espace introuvable.")
    existing = get_user_by_email(mail)
    if existing:
        membership = get_membership(workspace_id, str(existing["id"]))
        if membership:
            role = normalize_role(str(membership.get("role") or ""))
            if is_operator_role(role):
                raise ValueError("Cet e-mail appartient déjà à un membre de l’équipe Korymb.")
            status = normalize_participant_status(membership.get("status"), role="subscriber")
            if status == "active":
                raise ValueError("Cette personne est déjà participante.")
            if status == "pending":
                raise ValueError("Une inscription est déjà en attente de validation pour cet e-mail.")
            code = new_invite_code()
            participant = upsert_subscriber_membership(
                workspace_id,
                str(existing["id"]),
                status="guest",
                invite_code=code,
                display_name=display_name,
            )
        else:
            code = new_invite_code()
            add_member(workspace_id, mail, "subscriber", status="guest", invite_code=code)
            if display_name.strip():
                from workspace_db import update_user_profile

                update_user_profile(str(existing["id"]), display_name=display_name)
            participant = serialize_participant(
                {**(get_user_by_id(str(existing["id"])) or {}), **(get_membership(workspace_id, str(existing["id"])) or {}), "id": existing["id"]},
                include_invite_code=True,
            )
            participant["invite_code"] = code
    else:
        code = new_invite_code()
        user = create_user(mail, hash_password(secrets.token_urlsafe(24)), display_name)
        add_member(workspace_id, mail, "subscriber", status="guest", invite_code=code)
        participant = serialize_participant(
            {**user, **(get_membership(workspace_id, str(user["id"])) or {}), "id": user["id"]},
            include_invite_code=True,
        )
        participant["invite_code"] = code
    mail_sent, mail_note = _send_guest_invite_email(
        to=mail,
        name=str(participant.get("display_name") or mail.split("@")[0]),
        code=str(participant.get("invite_code") or code),
        slug=str(workspace.get("slug") or ""),
        workspace_name=str(workspace.get("name") or "Korymb"),
    )
    participant["mail_sent"] = mail_sent
    participant["mail_note"] = mail_note
    return participant


def redeem_subscriber_invite(
    *,
    workspace_slug: str,
    email: str,
    code: str,
    password: str,
    display_name: str = "",
) -> dict[str, Any]:
    workspace = get_workspace_by_slug(workspace_slug)
    if not workspace or not workspace_public_enabled(workspace):
        raise ValueError("Vitrine introuvable ou non publiée.")
    ws_id = str(workspace["id"])
    row = get_guest_membership_by_code(ws_id, email, code)
    if not row:
        raise ValueError("Code invité invalide. Vérifiez l’e-mail et le code reçus.")
    user_id = str(row.get("user_id") or "")
    hashed = hash_password(password)
    set_user_password_hash(user_id, hashed)
    if display_name.strip():
        from workspace_db import update_user_profile

        update_user_profile(user_id, display_name=display_name)
    participant = set_subscriber_status(ws_id, user_id, "active")
    token = create_access_token(user_id=user_id, workspace_id=ws_id, role="subscriber")
    return {
        "token": token,
        "user": get_user_by_id(user_id),
        "workspace": {
            "id": workspace.get("id"),
            "name": workspace.get("name"),
            "slug": workspace.get("slug"),
        },
        "role": "subscriber",
        "membership_status": "active",
        "participant": participant,
    }


def validate_subscriber(workspace_id: str, user_id: str) -> dict[str, Any]:
    row = set_subscriber_status(workspace_id, user_id, "active")
    if not row:
        raise ValueError("Participant introuvable.")
    return row


def _send_guest_invite_email(
    *,
    to: str,
    name: str,
    code: str,
    slug: str,
    workspace_name: str,
) -> tuple[bool, str]:
    import os
    from urllib.parse import quote

    public = (os.getenv("KORYMB_PUBLIC_URL") or "https://korymb.eludein.art").strip().rstrip("/")
    link = f"{public}/p/{quote(slug)}/invitation?email={quote(to)}&code={quote(code)}"
    body = (
        f"Bonjour {name},\n\n"
        f"Vous êtes invité(e) à l’espace participant de {workspace_name}.\n\n"
        f"Code invité : {code}\n"
        f"Première connexion : {link}\n\n"
        "Choisissez votre mot de passe lors de cette première connexion. "
        "Ce n’est pas un compte Korymb (l’outil de gestion).\n"
    )
    try:
        from tools.google_api import run_send_gmail

        result = run_send_gmail(to, f"Invitation participant — {workspace_name}", body)
        text = str(result or "")
        lowered = text.lower()
        if "simul" in lowered or "non configuré" in lowered or "requis" in lowered:
            return False, text
        return True, text
    except Exception as exc:
        logger.warning("invite email failed: %s", exc)
        return False, str(exc)


def login_user(*, email: str, password: str, workspace_id: str | None = None, audience: str | None = None) -> dict[str, Any]:
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
        chosen = next((w for w in workspaces if w["id"] == target_ws or w.get("slug") == target_ws), None)
        if not chosen:
            raise ValueError("Vous n'avez pas accès à cet espace Korymb.")
    else:
        chosen = workspaces[0]
    role = normalize_role(str(chosen.get("role") or "member"))
    wanted = (audience or "").strip()
    slug = str(chosen.get("slug") or "")
    if wanted == "operator" and role == "subscriber":
        raise PermissionError(
            "Ceci est la connexion à l’outil Korymb. Pour vos ressources, connectez-vous depuis la vitrine"
            + (f" (/p/{slug}/connexion)." if slug else ".")
        )
    if wanted == "subscriber" and is_operator_role(role):
        raise PermissionError(
            "Ceci est la connexion participant. L’outil Korymb s’ouvre via Connexion Korymb."
        )
    token = create_access_token(user_id=row["id"], workspace_id=chosen["id"], role=role)
    membership = get_membership(str(chosen["id"]), str(row["id"])) or {}
    membership_status = normalize_participant_status(membership.get("status"), role=role)
    return {
        "token": token,
        "user": user,
        "workspace": get_workspace_by_id(chosen["id"]),
        "workspaces": workspaces,
        "role": role,
        "membership_status": membership_status,
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
        role = normalize_role(str(membership.get("role") or "member"))
        return ws, user_id, role
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
    if role == "subscriber" and not subscriber_path_allowed(request.url.path):
        raise HTTPException(
            status_code=403,
            detail="Espace participant uniquement — le cockpit dirigeant n'est pas accessible avec ce compte.",
        )
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
    members = list_workspace_operators(workspace_id) if membership else []
    role = normalize_role(str((membership or {}).get("role") or "member"))
    ws = dict(workspace or {})
    return {
        "user": user,
        "workspace": {
            "id": ws.get("id"),
            "name": ws.get("name"),
            "slug": ws.get("slug"),
            "public_enabled": workspace_public_enabled(ws),
            "tagline": ws.get("tagline") or "",
        },
        "workspaces": workspaces,
        "members": members,
        "role": role,
        "membership_status": normalize_participant_status(
            (membership or {}).get("status"),
            role=role,
        ),
    }
