"""Routes auth — inscription, connexion, profil, membres."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from services import workspace_auth as auth_svc

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=120)
    workspace_name: str = Field(default="", max_length=200)
    starter_pack_id: str = Field(default="blank", max_length=64)


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    workspace_id: str | None = Field(default=None, max_length=64)
    audience: str | None = Field(default=None, max_length=20)


class RegisterSubscriberBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=120)
    workspace_slug: str = Field(min_length=2, max_length=48)


class RedeemInviteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    code: str = Field(min_length=4, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=120)
    workspace_slug: str = Field(min_length=2, max_length=48)


class CreateWorkspaceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    starter_pack_id: str = Field(default="blank", max_length=64)


class ApplyStarterPackBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starter_pack_id: str = Field(min_length=1, max_length=64)


class UiModeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ui_mode: str = Field(pattern="^(essential|advanced)$")


class InviteMemberBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    role: str = Field(default="member", pattern="^(admin|member)$")


class ProfilePatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=200)
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


@router.post("/register")
def auth_register(body: RegisterBody):
    try:
        return auth_svc.register_user(
            email=str(body.email),
            password=body.password,
            display_name=body.display_name,
            workspace_name=body.workspace_name,
            starter_pack_id=body.starter_pack_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/starter-packs")
def auth_list_starter_packs():
    from services.starter_packs import list_starter_packs

    return {"packs": list_starter_packs()}


@router.post("/register-subscriber")
def auth_register_subscriber(body: RegisterSubscriberBody):
    try:
        return auth_svc.register_subscriber(
            email=str(body.email),
            password=body.password,
            display_name=body.display_name,
            workspace_slug=body.workspace_slug,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/redeem-invite")
def auth_redeem_invite(body: RedeemInviteBody):
    try:
        return auth_svc.redeem_subscriber_invite(
            workspace_slug=body.workspace_slug,
            email=str(body.email),
            code=body.code,
            password=body.password,
            display_name=body.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/login")
def auth_login(body: LoginBody):
    try:
        return auth_svc.login_user(
            email=str(body.email),
            password=body.password,
            workspace_id=body.workspace_id,
            audience=body.audience,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/me")
def auth_me(auth: dict = Depends(auth_svc.resolve_tenant)):
    if auth.get("mode") == "agent_secret":
        return {
            "mode": "agent_secret",
            "user": None,
            "workspace": {"id": auth.get("workspace_id"), "name": "Espace legacy"},
            "role": "admin",
            "workspaces": [],
            "members": [],
        }
    user_id = str(auth.get("user_id") or "")
    workspace_id = str(auth.get("workspace_id") or "")
    profile = auth_svc.get_auth_profile(user_id, workspace_id)
    return {"mode": "user", **profile, "role": auth.get("role")}


@router.post("/workspaces")
def auth_create_workspace(body: CreateWorkspaceBody, auth: dict = Depends(auth_svc.resolve_tenant)):
    if auth.get("mode") == "agent_secret":
        raise HTTPException(status_code=400, detail="Création d'espace réservée aux utilisateurs connectés.")
    user_id = str(auth.get("user_id") or "")
    from workspace_db import create_workspace

    try:
        workspace = create_workspace(body.name, user_id, starter_pack_id=body.starter_pack_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = auth_svc.create_access_token(user_id=user_id, workspace_id=workspace["id"], role="admin")
    return {"workspace": workspace, "token": token, "role": "admin"}


@router.post("/workspaces/apply-starter-pack")
def auth_apply_starter_pack(
    body: ApplyStarterPackBody,
    auth: dict = Depends(auth_svc.require_admin),
):
    if auth.get("mode") == "agent_secret":
        raise HTTPException(status_code=400, detail="Application de modèle réservée aux utilisateurs connectés.")
    workspace_id = str(auth.get("workspace_id") or "")
    from services.starter_packs import apply_starter_pack

    try:
        return apply_starter_pack(workspace_id, body.starter_pack_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/workspace/ui-mode")
def auth_set_ui_mode(body: UiModeBody, auth: dict = Depends(auth_svc.require_admin)):
    if auth.get("mode") == "agent_secret":
        raise HTTPException(status_code=400, detail="Préférence réservée aux utilisateurs connectés.")
    workspace_id = str(auth.get("workspace_id") or "")
    from workspace_db import normalize_ui_mode, set_workspace_ui_mode

    try:
        workspace = set_workspace_ui_mode(workspace_id, body.ui_mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "workspace": {
            "id": (workspace or {}).get("id"),
            "name": (workspace or {}).get("name"),
            "ui_mode": normalize_ui_mode(
                (workspace or {}).get("ui_mode"),
                workspace_id=workspace_id,
            ),
        }
    }


@router.get("/members")
def auth_list_members(auth: dict = Depends(auth_svc.resolve_tenant)):
    if auth.get("mode") == "agent_secret":
        return {"members": []}
    from workspace_db import list_workspace_operators

    ws = str(auth.get("workspace_id") or "")
    return {"members": list_workspace_operators(ws)}


@router.post("/members")
def auth_invite_member(body: InviteMemberBody, auth: dict = Depends(auth_svc.require_admin)):
    if auth.get("mode") == "agent_secret":
        raise HTTPException(status_code=400, detail="Invitation réservée aux utilisateurs connectés.")
    ws = str(auth.get("workspace_id") or "")
    try:
        from workspace_db import add_member

        member = add_member(ws, str(body.email), body.role)  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"member": member}


@router.patch("/profile")
def auth_update_profile(body: ProfilePatchBody, auth: dict = Depends(auth_svc.resolve_tenant)):
    if auth.get("mode") == "agent_secret":
        raise HTTPException(status_code=400, detail="Profil réservé aux utilisateurs connectés.")
    user_id = str(auth.get("user_id") or "")
    workspace_id = str(auth.get("workspace_id") or "")
    from workspace_db import update_user_password, update_user_profile, update_workspace_name

    user = update_user_profile(user_id, display_name=body.display_name) if body.display_name is not None else None
    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Indiquez le mot de passe actuel.")
        try:
            user = update_user_password(
                user_id,
                current_password=body.current_password,
                new_password=body.new_password,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    workspace = None
    if body.workspace_name is not None:
        if auth.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Seul un admin peut renommer l'espace.")
        workspace = update_workspace_name(workspace_id, body.workspace_name)
    profile = auth_svc.get_auth_profile(user_id, workspace_id)
    return {
        "user": user or profile.get("user"),
        "workspace": workspace or profile.get("workspace"),
        "role": auth.get("role"),
    }
