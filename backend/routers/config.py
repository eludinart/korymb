from __future__ import annotations

from fastapi import APIRouter

from runtime_settings import merge_with_env, to_public_dict

router = APIRouter(prefix="/config", tags=["config-phase1"])


@router.get("/runtime/public")
def config_runtime_public():
    return to_public_dict(merge_with_env())

