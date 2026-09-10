"""Routes configuration intégrations & clés API (runtime overrides)."""
from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import require_admin
from integration_settings import catalog_for_api, save_partial, to_public_dict

router = APIRouter(tags=["integrations"])


class IntegrationSettingsPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    fields: dict[str, str] = Field(default_factory=dict)
    clear_fields: list[str] = Field(default_factory=list)


class IntegrationOAuthStart(BaseModel):
    model_config = ConfigDict(extra="ignore")

    provider: str = Field(min_length=2, max_length=32)
    redirect_uri: str = Field(min_length=8, max_length=500)


class IntegrationOAuthFinish(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str = Field(min_length=4, max_length=2000)
    state: str = Field(min_length=8, max_length=4000)


@router.get("/admin/integration-settings", dependencies=[Depends(require_admin)])
def admin_get_integration_settings():
    return {
        "catalog": catalog_for_api(),
        "values": to_public_dict(),
    }


@router.put("/admin/integration-settings", dependencies=[Depends(require_admin)])
def admin_put_integration_settings(body: IntegrationSettingsPut):
    if not body.fields and not body.clear_fields:
        raise HTTPException(status_code=400, detail="Aucune modification fournie.")
    try:
        values = save_partial(body.fields, clear_fields=body.clear_fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "catalog": catalog_for_api(),
        "values": values,
        "ok": True,
    }


@router.post("/admin/integrations/oauth/start", dependencies=[Depends(require_admin)])
def admin_integrations_oauth_start(body: IntegrationOAuthStart):
    from services.integration_oauth import start_oauth

    try:
        return start_oauth(provider=body.provider.strip().lower(), redirect_uri=body.redirect_uri.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/admin/integrations/oauth/finish", dependencies=[Depends(require_admin)])
def admin_integrations_oauth_finish(body: IntegrationOAuthFinish):
    from services.integration_oauth import finish_oauth

    try:
        return finish_oauth(code=body.code, state=body.state)
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=400, detail="Session OAuth expirée — relancez la connexion.") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
