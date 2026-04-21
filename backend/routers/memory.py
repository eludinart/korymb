from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from services.memory import read_active_memory

router = APIRouter(prefix="/memory", tags=["memory-phase1"])


class ActiveMemoryQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")
    agent: str = Field(default="coordinateur", min_length=2, max_length=64)
    proposal_limit: int = Field(default=6, ge=1, le=20)
    digest_limit: int = Field(default=8, ge=1, le=20)
    exclude_job_id: str | None = Field(default=None, max_length=16)


@router.post("/active-skill")
def memory_active_skill(body: ActiveMemoryQuery):
    snapshot = read_active_memory(
        proposal_limit=body.proposal_limit,
        digest_limit=body.digest_limit,
        exclude_job_id=body.exclude_job_id,
    )
    return {
        "agent": body.agent,
        "enterprise_memory": snapshot.enterprise_memory,
        "proposal_count": len(snapshot.proposals),
        "proposals": snapshot.proposals,
        "recent_jobs_digest": snapshot.recent_jobs_digest,
    }

