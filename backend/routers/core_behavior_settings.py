"""
API admin pour le registre `behavior_settings`.

Chaque clé correspond à un réglage d’orchestration documenté dans
`services/behavior_defaults.py` (label + description pour l’UI). Les valeurs
sont du JSON libre selon le type (int, float, texte, listes, dictionnaires).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from auth import verify_secret
from database import (
    get_behavior_setting,
    list_behavior_settings,
    seed_behavior_defaults,
    upsert_behavior_setting,
)
from services.behavior_defaults import BEHAVIOR_DEFAULTS, behavior_default_value

router = APIRouter(tags=["behavior-settings"])


class BehaviorPutBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    value: object


@router.get("/admin/behavior-settings", dependencies=[Depends(verify_secret)])
def behavior_settings_list():
    seed_behavior_defaults()
    return {"settings": list_behavior_settings()}


@router.get("/admin/behavior-settings/{setting_key}", dependencies=[Depends(verify_secret)])
def behavior_settings_get(setting_key: str):
    key = (setting_key or "").strip()
    if key not in BEHAVIOR_DEFAULTS:
        raise HTTPException(status_code=404, detail="Unknown behavior setting key")
    seed_behavior_defaults()
    value = get_behavior_setting(key)
    if value is None:
        value = behavior_default_value(key)
    meta = BEHAVIOR_DEFAULTS.get(key) or {}
    return {
        "setting_key": key,
        "value": value,
        "default_value": meta.get("value"),
        "category": meta.get("category"),
        "type": meta.get("type"),
        "label": meta.get("label"),
        "description": (meta.get("description") or "").strip(),
    }


@router.put("/admin/behavior-settings/{setting_key}", dependencies=[Depends(verify_secret)])
def behavior_settings_put(setting_key: str, body: BehaviorPutBody):
    key = (setting_key or "").strip()
    if key not in BEHAVIOR_DEFAULTS:
        raise HTTPException(status_code=404, detail="Unknown behavior setting key")
    return upsert_behavior_setting(key, body.value)


@router.post("/admin/behavior-settings/{setting_key}/reset", dependencies=[Depends(verify_secret)])
def behavior_settings_reset(setting_key: str):
    key = (setting_key or "").strip()
    if key not in BEHAVIOR_DEFAULTS:
        raise HTTPException(status_code=404, detail="Unknown behavior setting key")
    return upsert_behavior_setting(key, behavior_default_value(key))

