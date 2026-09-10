"""API Studio de contenus."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant
from services.studio import catalog, dismiss_studio_piece, launch_generation, list_studio_runs, publish_resource, release_studio_piece

router = APIRouter(tags=["studio"])


class StudioGenerateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=8, max_length=8000)
    formats: list[str] = Field(min_length=1, max_length=8)
    tone: str = "invite"
    audience: str = "coachs"
    cta: str = Field(default="", max_length=400)
    destination: str = "mission"
    visibility: str = "internal"
    extra: str = Field(default="", max_length=4000)
    project_id: str = Field(default="", max_length=64)
    require_user_validation: bool = True
    media_engine_mode: str = Field(default="", max_length=32)


class StudioPublishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=300)
    resource_type: str = "document"
    visibility: str = "internal"
    file_id: str = Field(default="", max_length=191)
    resource_url: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=4000)
    project_id: str = Field(default="", max_length=64)
    job_id: str = Field(default="", max_length=64)
    body_markdown: str = Field(default="", max_length=80_000)


@router.get("/studio/catalog", dependencies=[Depends(resolve_tenant)])
def studio_catalog():
    return catalog()


@router.get("/studio/runs", dependencies=[Depends(resolve_tenant)])
def studio_runs(limit: int = 20):
    return {"runs": list_studio_runs(limit=max(1, min(limit, 50)))}


@router.post("/studio/generate", dependencies=[Depends(resolve_tenant)])
def studio_generate(body: StudioGenerateBody, background_tasks: BackgroundTasks):
    try:
        return launch_generation(
            background_tasks,
            prompt=body.prompt,
            formats=body.formats,
            tone=body.tone,
            audience=body.audience,
            cta=body.cta,
            destination=body.destination,
            visibility=body.visibility,
            extra=body.extra,
            project_id=body.project_id,
            require_user_validation=body.require_user_validation,
            media_engine_mode=body.media_engine_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class StudioReleaseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=4, max_length=64)
    format_id: str = Field(default="", max_length=64)
    target: str = Field(default="", max_length=32)
    visibility: str = "participants"
    title: str = Field(default="", max_length=300)


@router.post("/studio/release", dependencies=[Depends(resolve_tenant)])
def studio_release(body: StudioReleaseBody):
    try:
        return release_studio_piece(
            job_id=body.job_id,
            format_id=body.format_id,
            target=body.target,
            visibility=body.visibility,
            title=body.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class StudioDismissBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=4, max_length=64)
    format_id: str = Field(default="", max_length=64)
    confirm: str = Field(min_length=1, max_length=32)


@router.post("/studio/dismiss", dependencies=[Depends(resolve_tenant)])
def studio_dismiss(body: StudioDismissBody):
    try:
        return dismiss_studio_piece(job_id=body.job_id, format_id=body.format_id, confirm=body.confirm)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/studio/publish", dependencies=[Depends(resolve_tenant)])
def studio_publish(body: StudioPublishBody):
    try:
        return publish_resource(
            title=body.title,
            resource_type=body.resource_type,
            visibility=body.visibility,
            file_id=body.file_id,
            resource_url=body.resource_url,
            notes=body.notes,
            project_id=body.project_id,
            job_id=body.job_id,
            body_markdown=body.body_markdown,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
