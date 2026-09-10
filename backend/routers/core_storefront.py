"""Vitrine publique, espace participant, réglages dirigeant."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from services import workspace_auth as auth_svc
from services.business_db import (
    load_event_cover_file,
    load_event_resource_file,
    load_public_storefront_resource_file,
)
from services.storefront import get_public_storefront, get_storefront_settings, get_subscriber_home
from tenant_context import is_operator_role
from workspace_db import (
    get_membership,
    get_user_by_id,
    get_workspace_by_slug,
    list_workspace_subscribers,
    update_workspace_storefront,
    participant_is_active,
    workspace_public_enabled,
)

router = APIRouter(tags=["storefront"])


class StorefrontOfferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=500)
    kind: str = Field(default="", max_length=20)


class StorefrontSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_enabled: bool | None = None
    slug: str | None = Field(default=None, max_length=48)
    name: str | None = Field(default=None, max_length=200)
    tagline: str | None = Field(default=None, max_length=240)
    intro: str | None = Field(default=None, max_length=4000)
    offers: list[StorefrontOfferIn] | None = None
    location: str | None = Field(default=None, max_length=200)
    contact_email: str | None = Field(default=None, max_length=191)
    contact_url: str | None = Field(default=None, max_length=500)
    accent: str | None = Field(default=None, max_length=32)
    paper: str | None = Field(default=None, max_length=32)
    typeface: str | None = Field(default=None, max_length=32)
    logo_file_id: str | None = Field(default=None, max_length=191)
    cover_file_id: str | None = Field(default=None, max_length=191)


@router.get("/public/storefront/{slug}")
def public_storefront(slug: str):
    data = get_public_storefront(slug)
    if not data:
        raise HTTPException(status_code=404, detail="Vitrine introuvable ou non publiée.")
    return data


@router.get("/public/storefront/{slug}/events/{event_id}/file")
def public_storefront_event_file(slug: str, event_id: str, inline: bool = Query(default=False)):
    workspace = get_workspace_by_slug(slug)
    if not workspace:
        raise HTTPException(status_code=404, detail="Vitrine introuvable ou non publiée.")
    from services.resource_files import as_fastapi_response
    from workspace_db import workspace_public_enabled

    if not workspace_public_enabled(workspace):
        raise HTTPException(status_code=404, detail="Vitrine introuvable ou non publiée.")
    item = load_public_storefront_resource_file(str(workspace["id"]), event_id)
    if not item:
        raise HTTPException(status_code=404, detail="Ressource introuvable ou encore privée.")
    return as_fastapi_response(item, inline=inline)


@router.get("/public/storefront/{slug}/events/{event_id}/cover")
def public_storefront_event_cover(slug: str, event_id: str, inline: bool = Query(default=True)):
    workspace = get_workspace_by_slug(slug)
    if not workspace or not workspace_public_enabled(workspace):
        raise HTTPException(status_code=404, detail="Vitrine introuvable ou non publiée.")
    from services.resource_files import as_fastapi_response

    item = load_event_cover_file(
        event_id,
        workspace_id=str(workspace["id"]),
        public_access=True,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Visuel introuvable.")
    return as_fastapi_response(item, inline=inline, public=True, download_name=str(item.get("filename") or "cover"))


@router.get("/public/storefront/{slug}/brand/{kind}")
def public_storefront_brand_file(slug: str, kind: str, inline: bool = Query(default=True)):
    if kind not in ("logo", "cover"):
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    workspace = get_workspace_by_slug(slug)
    if not workspace or not workspace_public_enabled(workspace):
        raise HTTPException(status_code=404, detail="Vitrine introuvable ou non publiée.")
    from services.resource_files import as_fastapi_response, load_local_file

    field = "logo_file_id" if kind == "logo" else "cover_file_id"
    file_id = str(workspace.get(field) or "").strip()
    item = load_local_file(file_id, workspace_id=str(workspace.get("id") or ""))
    if not item:
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    return as_fastapi_response(item, inline=inline, public=True, download_name=str(item.get("filename") or kind))


@router.get("/subscriber/home")
def subscriber_home(auth: dict = Depends(auth_svc.resolve_tenant)):
    ws = str(auth.get("workspace_id") or "")
    user_id = str(auth.get("user_id") or "")
    user = get_user_by_id(user_id) or {}
    membership = get_membership(ws, user_id) or {}
    role = str(auth.get("role") or membership.get("role") or "")
    status = str(membership.get("status") or "")
    data = get_subscriber_home(
        ws,
        viewer_email=str(user.get("email") or ""),
        viewer_user_id=user_id,
        viewer_active=participant_is_active(status, role=role),
        membership_status=status if not is_operator_role(role) else "active",
    )
    if not data:
        raise HTTPException(status_code=404, detail="Espace introuvable.")
    return data


@router.get("/subscriber/events/{event_id}/file")
def subscriber_event_file(
    event_id: str,
    inline: bool = Query(default=False),
    auth: dict = Depends(auth_svc.resolve_tenant),
):
    """Télécharge une ressource débloquée (date de début atteinte, visibilité suffisante)."""
    from services.resource_files import as_fastapi_response

    user = get_user_by_id(str(auth.get("user_id") or "")) or {}
    user_id = str(auth.get("user_id") or "")
    membership = get_membership(str(auth.get("workspace_id") or ""), user_id) or {}
    role = str(auth.get("role") or membership.get("role") or "")
    item = load_event_resource_file(
        event_id,
        require_unlocked=True,
        viewer_email=str(user.get("email") or ""),
        viewer_user_id=user_id,
        viewer_active=participant_is_active(membership.get("status"), role=role),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Ressource introuvable ou pas encore ouverte.")
    return as_fastapi_response(item, inline=inline)


@router.get("/subscriber/events/{event_id}/cover")
def subscriber_event_cover(
    event_id: str,
    inline: bool = Query(default=True),
    auth: dict = Depends(auth_svc.resolve_tenant),
):
    from services.resource_files import as_fastapi_response

    user = get_user_by_id(str(auth.get("user_id") or "")) or {}
    user_id = str(auth.get("user_id") or "")
    membership = get_membership(str(auth.get("workspace_id") or ""), user_id) or {}
    role = str(auth.get("role") or membership.get("role") or "")
    item = load_event_cover_file(
        event_id,
        viewer_email=str(user.get("email") or ""),
        viewer_user_id=user_id,
        viewer_active=participant_is_active(membership.get("status"), role=role),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Visuel introuvable.")
    return as_fastapi_response(item, inline=inline, download_name=str(item.get("filename") or "cover"))


@router.get("/storefront/settings")
def storefront_settings_get(auth: dict = Depends(auth_svc.require_admin)):
    ws = str(auth.get("workspace_id") or "")
    data = get_storefront_settings(ws)
    if not data:
        raise HTTPException(status_code=404, detail="Espace introuvable.")
    return data


@router.patch("/storefront/settings")
def storefront_settings_patch(body: StorefrontSettingsPatch, auth: dict = Depends(auth_svc.require_admin)):
    ws = str(auth.get("workspace_id") or "")
    try:
        row = update_workspace_storefront(
            ws,
            public_enabled=body.public_enabled,
            slug=body.slug,
            name=body.name,
            tagline=body.tagline,
            intro=body.intro,
            offers=[o.model_dump() for o in body.offers] if body.offers is not None else None,
            location=body.location,
            contact_email=body.contact_email,
            contact_url=body.contact_url,
            accent=body.accent,
            paper=body.paper,
            typeface=body.typeface,
            logo_file_id=body.logo_file_id,
            cover_file_id=body.cover_file_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Espace introuvable.")
    settings = get_storefront_settings(ws)
    try:
        from services.memory_inbox import sync_storefront_brand_to_memory

        sync_storefront_brand_to_memory(settings)
    except Exception:
        pass
    return settings


@router.post("/storefront/brand-files")
async def storefront_upload_brand_file(
    kind: str = Query(default="logo"),
    file: UploadFile = File(...),
    auth: dict = Depends(auth_svc.require_admin),
):
    if kind not in ("logo", "cover"):
        raise HTTPException(status_code=400, detail="Type d’image : logo ou cover.")
    from services.resource_files import save_brand_image

    data = await file.read()
    result = save_brand_image(
        filename=file.filename or f"{kind}.jpg",
        mime=file.content_type or "image/jpeg",
        data=data,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Upload impossible",
        )
    ws = str(auth.get("workspace_id") or "")
    field = "logo_file_id" if kind == "logo" else "cover_file_id"
    update_workspace_storefront(ws, **{field: str((result.get("file") or {}).get("id") or "")})
    return result


def _require_operator(auth: dict) -> dict:
    if auth.get("mode") == "agent_secret":
        return auth
    if not is_operator_role(str(auth.get("role") or "")):
        raise HTTPException(status_code=403, detail="Réservé à l’équipe Korymb.")
    return auth


class InviteParticipantBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    display_name: str = Field(default="", max_length=120)


@router.get("/storefront/participants")
def storefront_list_participants(auth: dict = Depends(auth_svc.resolve_tenant)):
    _require_operator(auth)
    ws = str(auth.get("workspace_id") or "")
    rows = list_workspace_subscribers(ws)
    active = [p for p in rows if p.get("status") == "active"]
    return {"participants": rows, "active": active, "count": len(rows)}


@router.post("/storefront/participants/invite")
def storefront_invite_participant(body: InviteParticipantBody, auth: dict = Depends(auth_svc.resolve_tenant)):
    _require_operator(auth)
    ws = str(auth.get("workspace_id") or "")
    try:
        participant = auth_svc.invite_subscriber(
            workspace_id=ws,
            email=str(body.email),
            display_name=body.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"participant": participant}


@router.post("/storefront/participants/{user_id}/validate")
def storefront_validate_participant(user_id: str, auth: dict = Depends(auth_svc.resolve_tenant)):
    _require_operator(auth)
    ws = str(auth.get("workspace_id") or "")
    try:
        participant = auth_svc.validate_subscriber(ws, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"participant": participant}
