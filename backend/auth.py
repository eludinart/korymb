from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import APIKeyHeader

from config import settings

api_key_header = APIKeyHeader(name="X-Agent-Secret", auto_error=True)


def verify_secret(key: str = Depends(api_key_header)) -> str:
    if key != settings.agent_api_secret:
        raise HTTPException(status_code=403, detail="Secret invalide.")
    return key

