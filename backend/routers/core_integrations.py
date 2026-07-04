"""Routes configuration intégrations & clés API (runtime overrides)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant, require_admin
from integration_settings import catalog_for_api, save_partial, to_public_dict

router = APIRouter(tags=["integrations"])


class IntegrationSettingsPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    fields: dict[str, str] = Field(default_factory=dict)
    clear_fields: list[str] = Field(default_factory=list)


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
