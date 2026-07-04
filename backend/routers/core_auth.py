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


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    workspace_id: str | None = Field(default=None, max_length=64)


class CreateWorkspaceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)


class InviteMemberBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    role: str = Field(default="member", pattern="^(admin|member)$")


class ProfilePatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=200)


@router.post("/register")
def auth_register(body: RegisterBody):
    try:
        return auth_svc.register_user(
            email=str(body.email),
            password=body.password,
            display_name=body.display_name,
            workspace_name=body.workspace_name,
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
        )
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

    workspace = create_workspace(body.name, user_id)
    token = auth_svc.create_access_token(user_id=user_id, workspace_id=workspace["id"], role="admin")
    return {"workspace": workspace, "token": token, "role": "admin"}


@router.get("/members")
def auth_list_members(auth: dict = Depends(auth_svc.resolve_tenant)):
    if auth.get("mode") == "agent_secret":
        return {"members": []}
    from workspace_db import list_workspace_members

    ws = str(auth.get("workspace_id") or "")
    return {"members": list_workspace_members(ws)}


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
    from workspace_db import update_user_profile, update_workspace_name

    user = update_user_profile(user_id, display_name=body.display_name) if body.display_name is not None else None
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
