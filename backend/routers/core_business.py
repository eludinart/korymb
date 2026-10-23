"""
routers/core_business.py — API gestion métier (contacts, projets, devis, planning, Tiime).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Path, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import resolve_tenant
from database import LONG_TEXT_CHARS
from services.business_db import (
    CONTACT_STATUSES,
    CONTACT_TYPES,
    EVENT_STATUSES,
    EVENT_TYPES,
    EVENT_MODALITIES,
    EVENT_NATURES,
    EVENT_RESOURCE_TYPES,
    EVENT_VISIBILITIES,
    INTERACTION_TYPES,
    INVOICE_STATUSES,
    PROJECT_STATUSES,
    PROJECT_TYPES,
    QUOTE_STATUSES,
    apply_enrichment_proposal,
    apply_outreach_from_job,
    build_contact_exploration_mission,
    build_contact_outreach_mission,
    complete_crm_follow_up,
    create_calendar_event,
    actor_label,
    create_contact,
    create_external_invoice,
    disqualify_contact,
    create_project,
    create_quote,
    delete_calendar_event,
    delete_contact,
    ProjectMilestoneConflict,
    ProjectMilestoneNotFound,
    delete_project,
    delete_quote,
    exploration_result_summary,
    fill_contact_from_exploration,
    get_business_overview,
    get_calendar_event,
    load_event_resource_file,
    get_contact,
    get_enrichment_proposal,
    get_external_invoice,
    get_project,
    get_quote,
    list_calendar_events,
    list_contacts,
    list_enrichment_proposals,
    list_external_invoices,
    list_interactions,
    list_projects,
    list_quotes,
    prepare_follow_up_email_ticket,
    rebalance_all_contacts_notes_outreach,
    rebalance_contact_notes_outreach,
    reject_enrichment_proposal,
    ProjectMilestoneConflict,
    ProjectMilestoneNotFound,
    set_project_milestone_done,
    set_project_milestone_notes,
    set_project_milestone_reply,
    update_calendar_event,
    update_contact,
    update_external_invoice,
    update_project,
    update_quote,
)
from services.email_prospecting import (
    delete_email_message_for_contact,
    delete_email_thread_for_contact,
    get_email_message,
    list_contact_email_threads,
    list_mailbox,
    prepare_contact_email_ticket,
    suggest_email_replies,
    sync_gmail_replies_for_contact,
    sync_gmail_replies_mailbox,
)
from services.director_platform import emit_director_notification
from services.tiime_client import is_tiime_automation_configured, request_tiime_invoice
from services.work_tasks import (
    TASK_STATUSES,
    create_work_task,
    delete_work_task,
    get_work_task,
    list_work_tasks,
    update_work_task,
)
from services.knowledge_documents import (
    DOC_STATUSES,
    archive_knowledge_document,
    create_knowledge_document,
    get_knowledge_document,
    list_knowledge_documents,
    migrate_calendar_document_events,
    update_knowledge_document,
)
from services.science_overview import get_science_overview

logger = logging.getLogger("korymb.business")

router = APIRouter(tags=["business"])


# ── Models ────────────────────────────────────────────────────────────────────

class QuoteLine(BaseModel):
    label: str = Field(..., min_length=1, max_length=500)
    qty: float = Field(default=1, gt=0, le=9999)
    unit_price_cents: int = Field(default=0, ge=0)
    tax_rate: float = Field(default=0, ge=0, le=100)


class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: str = ""
    phone: str = ""
    company: str = ""
    contact_type: str = "prospect"
    status: str = "active"
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    outreach_suggestions: str = ""
    website: str = ""
    linkedin_url: str = ""
    address: str = ""
    city: str = ""
    postal_code: str = ""
    socials: dict[str, str] = Field(default_factory=dict)


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    contact_type: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    outreach_suggestions: str | None = None
    website: str | None = None
    linkedin_url: str | None = None
    address: str | None = None
    city: str | None = None
    postal_code: str | None = None
    socials: dict[str, str] | None = None
    verified_at: str | None = None


class EnrichmentApplyBody(BaseModel):
    fields: list[str] | None = None


class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    contact_id: str | None = None
    description: str = ""
    project_type: str = "autre"
    status: str = "draft"
    location: str = ""
    start_date: str | None = None
    end_date: str | None = None
    milestones: list[dict] = Field(default_factory=list)
    linked_job_ids: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    title: str | None = None
    contact_id: str | None = None
    description: str | None = None
    project_type: str | None = None
    status: str | None = None
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    milestones: list[dict] | None = None
    linked_job_ids: list[str] | None = None


class MilestoneDoneBody(BaseModel):
    done: bool = True
    label: str = Field(default="", max_length=LONG_TEXT_CHARS)


class MilestoneReplyBody(BaseModel):
    reply: str = Field(default="", max_length=4000)
    label: str = Field(default="", max_length=LONG_TEXT_CHARS)
    conversation_id: str | None = Field(default=None, max_length=64)


class MilestoneNotesBody(BaseModel):
    notes: str = Field(default="", max_length=LONG_TEXT_CHARS)
    label: str = Field(default="", max_length=LONG_TEXT_CHARS)


class WorkTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=800)
    due_at: str | None = None
    project_id: str | None = None
    priority: str = ""
    urgent: bool = False
    important: bool = False
    notes: str = Field(default="", max_length=LONG_TEXT_CHARS)
    assignee: str = ""


class WorkTaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=800)
    status: str | None = None
    due_at: str | None = None
    project_id: str | None = None
    priority: str | None = None
    urgent: bool | None = None
    important: bool | None = None
    notes: str | None = Field(default=None, max_length=LONG_TEXT_CHARS)
    assignee: str | None = None
    reply: str | None = Field(default=None, max_length=4000)
    chat_conversation_id: str | None = Field(default=None, max_length=64)


class KnowledgeDocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=400)
    summary: str = Field(default="", max_length=4000)
    content_md: str = Field(default="", max_length=LONG_TEXT_CHARS)
    resource_file_id: str = ""
    project_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    category: str = Field(default="", max_length=120)
    author: str = Field(default="", max_length=120)


class KnowledgeDocumentUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=400)
    summary: str | None = Field(default=None, max_length=4000)
    content_md: str | None = Field(default=None, max_length=LONG_TEXT_CHARS)
    resource_file_id: str | None = None
    project_id: str | None = None
    tags: list[str] | None = None
    category: str | None = Field(default=None, max_length=120)
    author: str | None = Field(default=None, max_length=120)
    status: str | None = None


class QuoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    contact_id: str | None = None
    project_id: str | None = None
    lines: list[QuoteLine] = Field(default_factory=list)
    currency: str = "EUR"
    status: str = "draft"
    valid_until: str | None = None
    notes: str = ""


class QuoteUpdate(BaseModel):
    title: str | None = None
    contact_id: str | None = None
    project_id: str | None = None
    lines: list[QuoteLine] | None = None
    currency: str | None = None
    status: str | None = None
    valid_until: str | None = None
    notes: str | None = None


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    starts_at: str
    ends_at: str | None = None
    contact_id: str | None = None
    project_id: str | None = None
    event_type: str = "seance"
    location: str = ""
    status: str = "planned"
    notes: str = ""
    is_public: bool = False
    visibility: str | None = None
    audience_contact_ids: list[str] = Field(default_factory=list)
    audience_user_ids: list[str] = Field(default_factory=list)
    modality: str = ""
    nature: str = "presence"
    resource_type: str = ""
    resource_url: str = ""
    resource_file_id: str = ""
    cover_file_id: str = ""


class EventUpdate(BaseModel):
    title: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    contact_id: str | None = None
    project_id: str | None = None
    event_type: str | None = None
    location: str | None = None
    status: str | None = None
    notes: str | None = None
    is_public: bool | None = None
    visibility: str | None = None
    audience_contact_ids: list[str] | None = None
    audience_user_ids: list[str] | None = None
    modality: str | None = None
    nature: str | None = None
    resource_type: str | None = None
    resource_url: str | None = None
    resource_file_id: str | None = None
    cover_file_id: str | None = None


class ExternalInvoiceCreate(BaseModel):
    quote_id: str | None = None
    contact_id: str | None = None
    project_id: str | None = None
    tiime_invoice_id: str = ""
    tiime_status: str = "issued"
    external_url: str = ""
    amount_cents: int = Field(default=0, ge=0)
    currency: str = "EUR"
    issued_at: str | None = None
    paid_at: str | None = None


class ExternalInvoiceUpdate(BaseModel):
    tiime_invoice_id: str | None = None
    tiime_status: str | None = None
    external_url: str | None = None
    amount_cents: int | None = Field(default=None, ge=0)
    paid_at: str | None = None
    sync_error: str | None = None


def _lines_to_dict(lines: list[QuoteLine] | None) -> list[dict]:
    if not lines:
        return []
    return [ln.model_dump() for ln in lines]


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/business/overview", dependencies=[Depends(resolve_tenant)])
async def business_overview():
    return {
        "stats": get_business_overview(),
        "tiime": {
            "automation_configured": is_tiime_automation_configured(),
            "app_url": "https://app.tiime.fr/",
        },
        "enums": {
            "contact_types": CONTACT_TYPES,
            "contact_statuses": CONTACT_STATUSES,
            "project_types": PROJECT_TYPES,
            "project_statuses": PROJECT_STATUSES,
            "quote_statuses": QUOTE_STATUSES,
            "event_types": EVENT_TYPES,
            "event_statuses": EVENT_STATUSES,
            "invoice_statuses": INVOICE_STATUSES,
            "interaction_types": INTERACTION_TYPES,
        },
    }


# ── Contacts ──────────────────────────────────────────────────────────────────

@router.get("/business/contacts", dependencies=[Depends(resolve_tenant)])
async def business_list_contacts(
    status: str | None = None,
    contact_type: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
):
    return {"contacts": list_contacts(status=status, contact_type=contact_type, limit=limit)}


@router.post("/business/contacts", dependencies=[Depends(resolve_tenant)])
async def business_create_contact(body: ContactCreate):
    if body.contact_type not in CONTACT_TYPES:
        raise HTTPException(422, detail=f"contact_type invalide — {CONTACT_TYPES}")
    if body.status not in CONTACT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {CONTACT_STATUSES}")
    return create_contact(**body.model_dump())


@router.get("/business/contacts/{contact_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_contact(contact_id: str):
    row = get_contact(contact_id)
    if not row:
        raise HTTPException(404, detail="Contact introuvable")
    return row


@router.put("/business/contacts/{contact_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_contact(contact_id: str, body: ContactUpdate):
    if body.contact_type and body.contact_type not in CONTACT_TYPES:
        raise HTTPException(422, detail=f"contact_type invalide — {CONTACT_TYPES}")
    if body.status and body.status not in CONTACT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {CONTACT_STATUSES}")
    row = update_contact(contact_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Contact introuvable")
    return row


@router.post("/business/contacts/{contact_id}/disqualify")
async def business_disqualify_contact(contact_id: str, auth: dict = Depends(resolve_tenant)):
    result = disqualify_contact(contact_id, actor=actor_label(auth))
    if not result:
        raise HTTPException(404, detail="Contact introuvable")
    if result.get("already"):
        raise HTTPException(409, detail="Contact déjà disqualifié.")
    return result


@router.delete("/business/contacts/{contact_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_contact(contact_id: str):
    if not delete_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    return {"deleted": True}


@router.post("/business/contacts/rebalance-notes", dependencies=[Depends(resolve_tenant)])
async def business_rebalance_contacts_notes():
    """Sépare notes factuelles / suggestions d'approche sur tous les contacts."""
    return rebalance_all_contacts_notes_outreach()


@router.post("/business/contacts/{contact_id}/rebalance-notes", dependencies=[Depends(resolve_tenant)])
async def business_rebalance_one_contact_notes(contact_id: str):
    result = rebalance_contact_notes_outreach(contact_id)
    if not result:
        raise HTTPException(404, detail="Contact introuvable")
    return result


class ExplorationFillBody(BaseModel):
    apply: bool = False


class ExploreContactBody(BaseModel):
    force: bool = False


@router.post("/business/contacts/{contact_id}/explore", dependencies=[Depends(resolve_tenant)])
async def business_explore_contact(
    contact_id: str,
    background_tasks: BackgroundTasks,
    body: ExploreContactBody | None = None,
):
    """Lance une mission Commercial d'exploration détaillée (proposition avant écriture)."""
    import uuid

    from services.mission import _mission_config_from_payload, _schedule_mission_execution

    contact = get_contact(contact_id)
    if not contact:
        raise HTTPException(404, detail="Contact introuvable")

    force = bool(body.force) if body else False
    reach = contact.get("reachability") if isinstance(contact.get("reachability"), dict) else {}
    if str(reach.get("level") or "") == "complete" and not force:
        raise HTTPException(
            409,
            detail=(
                "Fiche déjà complète (email + autre canal). "
                "Pas d'exploration automatique — passe force=true pour relancer quand même."
            ),
        )

    mission = build_contact_exploration_mission(contact)
    job_id = uuid.uuid4().hex[:12]
    mcfg = _mission_config_from_payload({
        "require_user_validation": True,
        "cio_plan_hitl_enabled": False,
        "cio_questions_enabled": False,
        "mode": "agent",
    })
    _schedule_mission_execution(
        background_tasks,
        job_id,
        "commercial",
        mission,
        {"contact_id": contact_id, "explore": True},
        f"contact_explore:{contact_id}",
        mission_config=mcfg,
    )
    return {
        "contact_id": contact_id,
        "job_id": job_id,
        "status": "accepted",
        "agent": "commercial",
        "reachability": contact.get("reachability"),
        "forced": force,
        "message": "Exploration lancée — le Commercial proposera un enrichissement à valider.",
    }


@router.get("/business/contacts/{contact_id}/exploration", dependencies=[Depends(resolve_tenant)])
async def business_get_contact_exploration(contact_id: str):
    """Dernière mission d'exploration + résumé résultat pour la fiche contact."""
    from database import get_job, get_latest_job_by_source

    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")

    job = get_latest_job_by_source(f"contact_explore:{contact_id}")
    if not job:
        return {
            "contact_id": contact_id,
            "job_id": None,
            "status": None,
            "result": None,
            "summary": None,
            "can_fill": False,
            "already_filled": False,
        }

    fresh = get_job(str(job.get("id") or "")) or job
    result = str(fresh.get("result") or "").strip()
    summary = exploration_result_summary(result)
    jid = str(fresh.get("id") or "")
    already = any(
        str(p.get("job_id") or "") == jid
        for p in list_enrichment_proposals(contact_id=contact_id, status="applied", limit=20)
    )
    status = str(fresh.get("status") or "")
    can_fill = bool(result) and status in {"completed", "done", "success"} and not already
    return {
        "contact_id": contact_id,
        "job_id": fresh.get("id"),
        "status": fresh.get("status"),
        "agent": fresh.get("agent"),
        "result": result or None,
        "summary": summary,
        "can_fill": can_fill,
        "already_filled": already,
        "created_at": fresh.get("created_at"),
        "updated_at": fresh.get("updated_at"),
    }


@router.post("/business/contacts/{contact_id}/exploration/fill", dependencies=[Depends(resolve_tenant)])
async def business_fill_contact_from_exploration(
    contact_id: str,
    body: ExplorationFillBody | None = None,
):
    """Remplit la fiche contact depuis le résultat de la dernière exploration."""
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    apply = False if body is None else bool(body.apply)
    result = fill_contact_from_exploration(contact_id, apply=apply)
    if not result:
        raise HTTPException(404, detail="Contact introuvable")
    if result.get("skipped") and result.get("reason") == "no_exploration_job":
        raise HTTPException(404, detail="Aucune exploration trouvée pour ce contact")
    if result.get("skipped") and result.get("reason") == "empty_model_result":
        raise HTTPException(400, detail="Le modèle n'a pas renvoyé de texte exploitable")
    if result.get("skipped") and result.get("reason") == "no_fields_extracted":
        raise HTTPException(400, detail="Impossible d'extraire des champs depuis le résultat d'exploration")
    return result


@router.post("/business/contacts/{contact_id}/outreach", dependencies=[Depends(resolve_tenant)])
async def business_launch_contact_outreach(contact_id: str, background_tasks: BackgroundTasks):
    """Lance une mission Commercial de suggestions d'approche avancées."""
    import uuid

    from services.mission import _mission_config_from_payload, _schedule_mission_execution

    contact = get_contact(contact_id)
    if not contact:
        raise HTTPException(404, detail="Contact introuvable")

    mission = build_contact_outreach_mission(contact)
    job_id = uuid.uuid4().hex[:12]
    mcfg = _mission_config_from_payload({
        "require_user_validation": False,
        "cio_plan_hitl_enabled": False,
        "cio_questions_enabled": False,
        "mode": "agent",
    })
    _schedule_mission_execution(
        background_tasks,
        job_id,
        "commercial",
        mission,
        {"contact_id": contact_id, "outreach": True},
        f"contact_outreach:{contact_id}",
        mission_config=mcfg,
    )
    return {
        "contact_id": contact_id,
        "job_id": job_id,
        "status": "accepted",
        "agent": "commercial",
        "message": "Suggestions avancées lancées — le Commercial approfondira l'approche.",
    }


@router.get("/business/contacts/{contact_id}/outreach", dependencies=[Depends(resolve_tenant)])
async def business_get_contact_outreach(contact_id: str):
    """Dernière mission de suggestions d'approche pour ce contact."""
    from database import get_job, get_latest_job_by_source

    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")

    job = get_latest_job_by_source(f"contact_outreach:{contact_id}")
    if not job:
        return {
            "contact_id": contact_id,
            "job_id": None,
            "status": None,
            "result": None,
            "can_apply": False,
            "already_applied": False,
        }

    fresh = get_job(str(job.get("id") or "")) or job
    result = str(fresh.get("result") or "").strip()
    jid = str(fresh.get("id") or "")
    already = any(
        str(p.get("job_id") or "") == jid
        and isinstance(p.get("proposed"), dict)
        and p["proposed"].get("outreach_suggestions")
        for p in list_enrichment_proposals(contact_id=contact_id, status="applied", limit=30)
    )
    status = str(fresh.get("status") or "")
    can_apply = bool(result) and status in {"completed", "done", "success"} and not already
    return {
        "contact_id": contact_id,
        "job_id": fresh.get("id"),
        "status": fresh.get("status"),
        "agent": fresh.get("agent"),
        "result": result or None,
        "can_apply": can_apply,
        "already_applied": already,
        "created_at": fresh.get("created_at"),
        "updated_at": fresh.get("updated_at"),
    }


@router.post("/business/contacts/{contact_id}/outreach/apply", dependencies=[Depends(resolve_tenant)])
async def business_apply_contact_outreach(contact_id: str):
    """Écrit les suggestions avancées sur la fiche (append outreach_suggestions)."""
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    result = apply_outreach_from_job(contact_id)
    if not result:
        raise HTTPException(404, detail="Contact introuvable")
    if result.get("skipped") and result.get("reason") == "no_outreach_job":
        raise HTTPException(404, detail="Aucune mission de suggestions trouvée")
    if result.get("skipped") and result.get("reason") == "no_outreach_extracted":
        raise HTTPException(400, detail="Impossible d'extraire des suggestions depuis le livrable")
    return result


@router.get("/business/contacts/{contact_id}/enrichment-proposals", dependencies=[Depends(resolve_tenant)])
async def business_list_contact_enrichments(
    contact_id: str,
    status: str | None = Query(default="pending"),
    limit: int = Query(default=10, ge=1, le=50),
):
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    return {
        "proposals": list_enrichment_proposals(contact_id=contact_id, status=status, limit=limit),
    }


@router.post(
    "/business/contacts/{contact_id}/enrichment-proposals/{proposal_id}/apply",
    dependencies=[Depends(resolve_tenant)],
)
async def business_apply_contact_enrichment(
    contact_id: str,
    proposal_id: str,
    body: EnrichmentApplyBody | None = None,
):
    proposal = get_enrichment_proposal(proposal_id)
    if not proposal or proposal.get("contact_id") != contact_id:
        raise HTTPException(404, detail="Proposition introuvable")
    result = apply_enrichment_proposal(
        proposal_id,
        fields=(body.fields if body else None),
    )
    if not result:
        raise HTTPException(400, detail="Impossible d'appliquer cette proposition (déjà traitée ?).")
    return result


@router.post(
    "/business/contacts/{contact_id}/enrichment-proposals/{proposal_id}/reject",
    dependencies=[Depends(resolve_tenant)],
)
async def business_reject_contact_enrichment(contact_id: str, proposal_id: str):
    proposal = get_enrichment_proposal(proposal_id)
    if not proposal or proposal.get("contact_id") != contact_id:
        raise HTTPException(404, detail="Proposition introuvable")
    row = reject_enrichment_proposal(proposal_id)
    return {"proposal": row}


class ContactEmailPrepareBody(BaseModel):
    subject: str = ""
    body: str = ""
    job_id: str = ""
    thread_id: str = ""
    in_reply_to: str = ""
    gmail_thread_id: str = ""
    attachment_ids: list[str] = Field(default_factory=list, max_length=5)


class ContactEmailSuggestBody(BaseModel):
    thread_id: str = ""
    message_id: str = ""
    guidance: str = Field(default="", max_length=4000)
    seed_body: str = Field(default="", max_length=4000)
    seed_subject: str = Field(default="", max_length=200)


@router.get("/business/emails", dependencies=[Depends(resolve_tenant)])
async def business_list_mailbox(
    bucket: str = Query(default="all"),
    limit: int = Query(default=80, ge=1, le=200),
):
    """Courrier prospection : tous les fils CRM + brouillons HITL."""
    return list_mailbox(bucket=bucket, limit=limit)


@router.post("/business/emails/sync", dependencies=[Depends(resolve_tenant)])
async def business_sync_mailbox():
    """Synchronise Gmail pour tous les contacts ayant un fil CRM ouvert."""
    result = sync_gmail_replies_mailbox()
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Sync Gmail impossible",
        )
    return result


def _attachment_response(data: bytes, filename: str, mime: str, *, inline: bool = False) -> Response:
    from services.email_files import can_inline, content_disposition

    use_inline = bool(inline and can_inline(mime))
    return Response(
        content=data,
        media_type=mime or "application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(filename, inline=use_inline),
            "Cache-Control": "private, max-age=120",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/business/email-files", dependencies=[Depends(resolve_tenant)])
async def business_upload_email_file(file: UploadFile = File(...)):
    """Dépose une pièce jointe avant préparation HITL (e-mail initial ou réponse)."""
    from services.email_files import save_upload

    data = await file.read()
    result = save_upload(
        filename=file.filename or "fichier",
        mime=file.content_type or "application/octet-stream",
        data=data,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Upload impossible",
        )
    return result


@router.get("/business/email-files/{file_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_email_file(file_id: str, inline: bool = Query(default=False)):
    """Consulte une PJ locale (brouillon HITL pas encore envoyé)."""
    from services.email_files import load_local_file, read_file_bytes

    item = load_local_file(file_id)
    if not item:
        raise HTTPException(404, detail="Fichier introuvable")
    return _attachment_response(
        read_file_bytes(item),
        str(item.get("filename") or "fichier"),
        str(item.get("mime") or "application/octet-stream"),
        inline=inline,
    )


@router.post("/business/resource-files", dependencies=[Depends(resolve_tenant)])
async def business_upload_resource_file(file: UploadFile = File(...)):
    """Dépose un fichier de ressource planning (vidéo, podcast, document)."""
    from services.resource_files import save_upload

    data = await file.read()
    result = save_upload(
        filename=file.filename or "fichier",
        mime=file.content_type or "application/octet-stream",
        data=data,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Upload impossible",
        )
    return result


@router.get("/business/resource-files/{file_id}/preview", dependencies=[Depends(resolve_tenant)])
def business_preview_resource_file(file_id: str):
    """Aperçu texte (CSV / markdown) pour lecture dans le cockpit — pas d'onglet brut."""
    from services.resource_files import preview_local_file

    payload = preview_local_file(file_id)
    if not payload:
        raise HTTPException(404, detail="Fichier introuvable")
    return payload


@router.get("/business/resource-files/{file_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_resource_file(file_id: str, inline: bool = Query(default=False)):
    from services.resource_files import as_fastapi_response, load_local_file

    item = load_local_file(file_id)
    if not item:
        raise HTTPException(404, detail="Fichier introuvable")
    return as_fastapi_response(item, inline=inline)


@router.get("/business/events/{event_id}/file", dependencies=[Depends(resolve_tenant)])
async def business_get_event_resource_file(event_id: str, inline: bool = Query(default=False)):
    from services.resource_files import as_fastapi_response

    item = load_event_resource_file(event_id)
    if not item:
        raise HTTPException(404, detail="Fichier introuvable")
    return as_fastapi_response(item, inline=inline)


@router.get(
    "/business/emails/messages/{message_id}/attachments/{attachment_id}",
    dependencies=[Depends(resolve_tenant)],
)
async def business_get_email_attachment(
    message_id: str,
    attachment_id: str,
    inline: bool = Query(default=False),
):
    """Télécharge ou ouvre une pièce jointe d'un message CRM (local ou Gmail)."""
    from services.email_files import load_attachment_payload, resolve_message_attachment

    message = get_email_message(message_id)
    if not message:
        raise HTTPException(404, detail="Message introuvable")
    meta = resolve_message_attachment(message, attachment_id)
    if not meta:
        raise HTTPException(404, detail="Pièce jointe introuvable")
    result = load_attachment_payload(message, meta)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Pièce jointe indisponible",
        )
    return _attachment_response(
        result["data"],
        str(result.get("filename") or meta.get("filename") or "fichier"),
        str(result.get("mime") or meta.get("mime") or "application/octet-stream"),
        inline=inline,
    )


@router.get("/business/contacts/{contact_id}/emails", dependencies=[Depends(resolve_tenant)])
async def business_list_contact_emails(
    contact_id: str,
    limit: int = Query(default=30, ge=1, le=100),
):
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    return {"threads": list_contact_email_threads(contact_id, limit=limit)}


@router.post("/business/contacts/{contact_id}/emails/prepare", dependencies=[Depends(resolve_tenant)])
async def business_prepare_contact_email(contact_id: str, body: ContactEmailPrepareBody | None = None):
    """Prépare un ticket e-mail HITL (validation inbox avant envoi réel)."""
    payload = body or ContactEmailPrepareBody()
    result = prepare_contact_email_ticket(
        contact_id,
        subject=payload.subject,
        body=payload.body,
        job_id=payload.job_id,
        thread_id=payload.thread_id,
        in_reply_to=payload.in_reply_to,
        gmail_thread_id=payload.gmail_thread_id,
        attachment_ids=payload.attachment_ids,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Impossible de préparer l'e-mail",
        )
    return result


@router.post("/business/contacts/{contact_id}/emails/send", dependencies=[Depends(resolve_tenant)])
async def business_send_contact_email(contact_id: str, body: ContactEmailPrepareBody | None = None):
    """Envoie l'e-mail depuis le rédacteur (sans passer par Décisions)."""
    payload = body or ContactEmailPrepareBody()
    result = prepare_contact_email_ticket(
        contact_id,
        subject=payload.subject,
        body=payload.body,
        job_id=payload.job_id,
        thread_id=payload.thread_id,
        in_reply_to=payload.in_reply_to,
        gmail_thread_id=payload.gmail_thread_id,
        attachment_ids=payload.attachment_ids,
        send_now=True,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Impossible d'envoyer l'e-mail",
        )
    return result


@router.post("/business/contacts/{contact_id}/emails/suggest-replies", dependencies=[Depends(resolve_tenant)])
async def business_suggest_contact_email_replies(
    contact_id: str,
    body: ContactEmailSuggestBody | None = None,
):
    """Propose 3 brouillons de réponse contextualisés (LLM, repli heuristique)."""
    payload = body or ContactEmailSuggestBody()
    result = suggest_email_replies(
        contact_id,
        thread_id=payload.thread_id,
        message_id=payload.message_id,
        guidance=payload.guidance,
        seed_body=payload.seed_body,
        seed_subject=payload.seed_subject,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Suggestions impossibles",
        )
    return result


@router.post("/business/contacts/{contact_id}/emails/sync", dependencies=[Depends(resolve_tenant)])
async def business_sync_contact_emails(contact_id: str):
    """Synchronise les réponses Gmail du contact vers les fils CRM."""
    result = sync_gmail_replies_for_contact(contact_id)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Sync Gmail impossible",
        )
    return result


@router.delete(
    "/business/contacts/{contact_id}/emails/messages/{message_id}",
    dependencies=[Depends(resolve_tenant)],
)
async def business_delete_contact_email_message(contact_id: str, message_id: str):
    """Retire un e-mail envoyé du suivi CRM (Gmail inchangé)."""
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    result = delete_email_message_for_contact(contact_id, message_id)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Suppression impossible",
        )
    return result


@router.delete(
    "/business/contacts/{contact_id}/emails/threads/{thread_id}",
    dependencies=[Depends(resolve_tenant)],
)
async def business_delete_contact_email_thread(contact_id: str, thread_id: str):
    """Retire un fil e-mail du suivi CRM (Gmail inchangé)."""
    if not get_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    result = delete_email_thread_for_contact(contact_id, thread_id)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Suppression impossible",
        )
    return result


@router.get("/business/interactions", dependencies=[Depends(resolve_tenant)])
async def business_list_interactions(
    contact_id: str | None = None,
    project_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    return {
        "interactions": list_interactions(
            contact_id=contact_id,
            project_id=project_id,
            limit=limit,
        ),
    }


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/business/projects", dependencies=[Depends(resolve_tenant)])
async def business_list_projects(
    status: str | None = None,
    contact_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
):
    return {"projects": list_projects(status=status, contact_id=contact_id, limit=limit)}


@router.post("/business/projects", dependencies=[Depends(resolve_tenant)])
async def business_create_project(body: ProjectCreate):
    if body.project_type not in PROJECT_TYPES:
        raise HTTPException(422, detail=f"project_type invalide — {PROJECT_TYPES}")
    if body.status not in PROJECT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {PROJECT_STATUSES}")
    return create_project(**body.model_dump())


@router.get("/business/projects/{project_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_project(project_id: str):
    row = get_project(project_id)
    if not row:
        raise HTTPException(404, detail="Projet introuvable")
    return row


@router.put("/business/projects/{project_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_project(project_id: str, body: ProjectUpdate):
    if body.project_type and body.project_type not in PROJECT_TYPES:
        raise HTTPException(422, detail=f"project_type invalide — {PROJECT_TYPES}")
    if body.status and body.status not in PROJECT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {PROJECT_STATUSES}")
    row = update_project(project_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Projet introuvable")
    return row


@router.post(
    "/business/projects/{project_id}/milestones/{index}/done",
    dependencies=[Depends(resolve_tenant)],
)
async def business_set_milestone_done(
    project_id: str,
    body: MilestoneDoneBody,
    index: int = Path(..., ge=0),
):
    try:
        return set_project_milestone_done(
            project_id,
            index,
            done=body.done,
            expected_label=body.label.strip() or None,
        )
    except ProjectMilestoneNotFound as exc:
        raise HTTPException(404, detail=str(exc) or "Étape introuvable") from exc
    except ProjectMilestoneConflict as exc:
        raise HTTPException(409, detail=str(exc) or "Cette étape a changé. Rechargez Aujourd'hui.") from exc


@router.post(
    "/business/projects/{project_id}/milestones/{index}/reply",
    dependencies=[Depends(resolve_tenant)],
)
async def business_set_milestone_reply(
    project_id: str,
    body: MilestoneReplyBody,
    index: int = Path(..., ge=0),
):
    try:
        return set_project_milestone_reply(
            project_id,
            index,
            reply=body.reply,
            expected_label=body.label.strip() or None,
            conversation_id=body.conversation_id,
            set_conversation="conversation_id" in body.model_fields_set,
        )
    except ProjectMilestoneNotFound as exc:
        raise HTTPException(404, detail=str(exc) or "Étape introuvable") from exc
    except ProjectMilestoneConflict as exc:
        raise HTTPException(409, detail=str(exc) or "Cette étape a changé. Rechargez Aujourd'hui.") from exc


@router.post(
    "/business/projects/{project_id}/milestones/{index}/notes",
    dependencies=[Depends(resolve_tenant)],
)
async def business_set_milestone_notes(
    project_id: str,
    body: MilestoneNotesBody,
    index: int = Path(..., ge=0),
):
    try:
        return set_project_milestone_notes(
            project_id,
            index,
            notes=body.notes,
            expected_label=body.label.strip() or None,
        )
    except ProjectMilestoneNotFound as exc:
        raise HTTPException(404, detail=str(exc) or "Étape introuvable") from exc
    except ProjectMilestoneConflict as exc:
        raise HTTPException(409, detail=str(exc) or "Cette étape a changé. Rechargez Aujourd'hui.") from exc


@router.delete("/business/projects/{project_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_project(project_id: str):
    if not delete_project(project_id):
        raise HTTPException(404, detail="Projet introuvable")
    return {"deleted": True}


def _task_or_422(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


# ── Tâches (hors projet possible) ────────────────────────────────────────────

@router.get("/business/tasks", dependencies=[Depends(resolve_tenant)])
async def business_list_tasks(
    status: str | None = None,
    unassigned: bool = Query(default=False),
    triage: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
):
    if status and status not in TASK_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {TASK_STATUSES}")
    if unassigned and triage:
        raise HTTPException(422, detail="unassigned et triage sont incompatibles")
    return {
        "tasks": list_work_tasks(
            status=status, unassigned=unassigned, triage=triage, limit=limit,
        )
    }


@router.post("/business/tasks", dependencies=[Depends(resolve_tenant)])
async def business_create_task(body: WorkTaskCreate):
    return _task_or_422(create_work_task, **body.model_dump())


@router.get("/business/tasks/{task_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_task(task_id: str):
    row = get_work_task(task_id)
    if not row:
        raise HTTPException(404, detail="Tâche introuvable")
    return row


@router.put("/business/tasks/{task_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_task(task_id: str, body: WorkTaskUpdate):
    row = _task_or_422(update_work_task, task_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Tâche introuvable")
    return row


@router.delete("/business/tasks/{task_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_task(task_id: str):
    if not delete_work_task(task_id):
        raise HTTPException(404, detail="Tâche introuvable")
    return {"deleted": True}


class ScheduleProposalAccept(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=64)
    due_at: str = Field(..., min_length=8, max_length=32)


@router.get("/business/schedule-proposals", dependencies=[Depends(resolve_tenant)])
async def business_list_schedule_proposals(limit: int = Query(default=8, ge=1, le=20)):
    """Propositions d'agenda (lecture seule) — aucune écriture calendrier."""
    from services.schedule_proposals import list_schedule_proposals

    return list_schedule_proposals(limit=limit)


@router.post("/business/schedule-proposals/accept", dependencies=[Depends(resolve_tenant)])
async def business_accept_schedule_proposal(body: ScheduleProposalAccept):
    """Accepte une proposition : pose due_at (+ sync calendrier). Pas d'écriture silencieuse."""
    from services.schedule_proposals import accept_schedule_proposal

    try:
        return accept_schedule_proposal(task_id=body.task_id, due_at=body.due_at)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


# ── Science de l'entreprise (documents) ───────────────────────────────────────

@router.get("/business/science-overview", dependencies=[Depends(resolve_tenant)])
async def business_science_overview():
    """Hub lecture seule : faits, mémoire (extrait), entités, docs, guide contexte."""
    return get_science_overview()


@router.get("/business/knowledge-documents", dependencies=[Depends(resolve_tenant)])
async def business_list_knowledge_documents(
    project_id: str | None = None,
    tag: str | None = None,
    category: str | None = None,
    q: str | None = None,
    include_archived: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
):
    return {
        "documents": list_knowledge_documents(
            project_id=project_id,
            tag=tag,
            category=category,
            q=q,
            include_archived=include_archived,
            limit=limit,
        )
    }


@router.post("/business/knowledge-documents", dependencies=[Depends(resolve_tenant)])
async def business_create_knowledge_document(body: KnowledgeDocumentCreate):
    return _task_or_422(create_knowledge_document, **body.model_dump())


@router.get("/business/knowledge-documents/{doc_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_knowledge_document(doc_id: str):
    row = get_knowledge_document(doc_id)
    if not row:
        raise HTTPException(404, detail="Document introuvable")
    return row


@router.put("/business/knowledge-documents/{doc_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_knowledge_document(doc_id: str, body: KnowledgeDocumentUpdate):
    if body.status and body.status not in DOC_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {DOC_STATUSES}")
    row = _task_or_422(update_knowledge_document, doc_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Document introuvable")
    return row


@router.post("/business/knowledge-documents/{doc_id}/archive", dependencies=[Depends(resolve_tenant)])
async def business_archive_knowledge_document(doc_id: str):
    row = _task_or_422(archive_knowledge_document, doc_id)
    if not row:
        raise HTTPException(404, detail="Document introuvable")
    return row


@router.post("/business/knowledge-documents/migrate-from-calendar", dependencies=[Depends(resolve_tenant)])
async def business_migrate_knowledge_from_calendar(dry_run: bool = False):
    return migrate_calendar_document_events(dry_run=dry_run)


# ── Quotes ────────────────────────────────────────────────────────────────────

@router.get("/business/quotes", dependencies=[Depends(resolve_tenant)])
async def business_list_quotes(
    status: str | None = None,
    contact_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
):
    quotes = list_quotes(status=status, contact_id=contact_id, limit=limit)
    return {"quotes": quotes}


@router.post("/business/quotes", dependencies=[Depends(resolve_tenant)])
async def business_create_quote(body: QuoteCreate):
    if body.status not in QUOTE_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {QUOTE_STATUSES}")
    data = body.model_dump()
    data["lines"] = _lines_to_dict(body.lines)
    return create_quote(**data)


@router.get("/business/quotes/{quote_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_quote(quote_id: str):
    row = get_quote(quote_id)
    if not row:
        raise HTTPException(404, detail="Devis introuvable")
    invoices = list_external_invoices(quote_id=quote_id)
    return {**row, "external_invoices": invoices}


@router.put("/business/quotes/{quote_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_quote(quote_id: str, body: QuoteUpdate):
    if body.status and body.status not in QUOTE_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {QUOTE_STATUSES}")
    payload = body.model_dump(exclude_unset=True)
    if body.lines is not None:
        payload["lines"] = _lines_to_dict(body.lines)
    row = update_quote(quote_id, **payload)
    if not row:
        raise HTTPException(404, detail="Devis introuvable")
    return row


@router.delete("/business/quotes/{quote_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_quote(quote_id: str):
    if not delete_quote(quote_id):
        raise HTTPException(404, detail="Devis introuvable")
    return {"deleted": True}


@router.post("/business/quotes/{quote_id}/request-tiime-invoice", dependencies=[Depends(resolve_tenant)])
async def business_request_tiime_invoice(quote_id: str):
    quote = get_quote(quote_id)
    if not quote:
        raise HTTPException(404, detail="Devis introuvable")
    contact = get_contact(quote["contact_id"]) if quote.get("contact_id") else None
    result = request_tiime_invoice(quote, contact)
    if quote.get("status") == "draft":
        update_quote(quote_id, status="sent")
    return result


# ── External invoices ─────────────────────────────────────────────────────────

@router.get("/business/external-invoices", dependencies=[Depends(resolve_tenant)])
async def business_list_invoices(quote_id: str | None = None, limit: int = Query(default=100, ge=1, le=200)):
    return {"invoices": list_external_invoices(quote_id=quote_id, limit=limit)}


@router.post("/business/external-invoices", dependencies=[Depends(resolve_tenant)])
async def business_create_invoice(body: ExternalInvoiceCreate):
    if body.tiime_status not in INVOICE_STATUSES:
        raise HTTPException(422, detail=f"tiime_status invalide — {INVOICE_STATUSES}")
    quote = get_quote(body.quote_id) if body.quote_id else None
    amount = body.amount_cents
    if quote and amount <= 0:
        amount = int(quote.get("total_cents") or 0)
    inv = create_external_invoice(
        quote_id=body.quote_id,
        contact_id=body.contact_id or (quote or {}).get("contact_id"),
        project_id=body.project_id or (quote or {}).get("project_id"),
        tiime_invoice_id=body.tiime_invoice_id,
        tiime_status=body.tiime_status,
        external_url=body.external_url,
        amount_cents=amount,
        currency=body.currency,
        issued_at=body.issued_at,
        paid_at=body.paid_at,
    )
    if quote and quote.get("id") and body.tiime_status in ("issued", "paid"):
        update_quote(quote["id"], status="accepted")
    return inv


@router.patch("/business/external-invoices/{invoice_id}", dependencies=[Depends(resolve_tenant)])
async def business_patch_invoice(invoice_id: str, body: ExternalInvoiceUpdate):
    if body.tiime_status and body.tiime_status not in INVOICE_STATUSES:
        raise HTTPException(422, detail=f"tiime_status invalide — {INVOICE_STATUSES}")
    row = update_external_invoice(invoice_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Facture externe introuvable")
    return row


# ── Calendar ──────────────────────────────────────────────────────────────────

@router.get("/business/events", dependencies=[Depends(resolve_tenant)])
async def business_list_events(
    from_at: str | None = None,
    to_at: str | None = None,
    project_id: str | None = None,
    limit: int = Query(default=300, ge=1, le=500),
):
    return {
        "events": list_calendar_events(from_at=from_at, to_at=to_at, project_id=project_id, limit=limit),
    }


@router.post("/business/events", dependencies=[Depends(resolve_tenant)])
async def business_create_event(body: EventCreate):
    if body.event_type not in EVENT_TYPES:
        raise HTTPException(422, detail=f"event_type invalide — {EVENT_TYPES}")
    if body.status not in EVENT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {EVENT_STATUSES}")
    if body.modality not in EVENT_MODALITIES:
        raise HTTPException(422, detail="modality invalide — présentiel, visio ou async")
    if body.nature not in EVENT_NATURES:
        raise HTTPException(422, detail="nature invalide — presence ou matiere")
    if body.resource_type not in EVENT_RESOURCE_TYPES:
        raise HTTPException(422, detail="resource_type invalide — video, podcast ou document")
    if body.visibility is not None and body.visibility not in EVENT_VISIBILITIES:
        raise HTTPException(422, detail="visibility invalide — internal, selected, participants ou public")
    if body.visibility == "selected" and not body.audience_user_ids and not body.audience_contact_ids and not body.contact_id:
        raise HTTPException(422, detail="Choisissez au moins un participant pour un accès nominatif.")
        raise HTTPException(422, detail="Choisissez au moins une personne pour un accès nominatif.")
    return create_calendar_event(**body.model_dump())


@router.get("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_event(event_id: str):
    row = get_calendar_event(event_id)
    if not row:
        raise HTTPException(404, detail="Événement introuvable")
    return row


_EVENT_NOTICE_FIELDS = ("title", "starts_at", "ends_at", "location", "status", "notes", "modality")


def _notice_event_change(before: dict, after: dict) -> None:
    """Alerte la cloche quand un rendez-vous change. Les créneaux de tâche restent silencieux."""
    if str(after.get("event_type") or before.get("event_type") or "") == "tache":
        return
    changed = any(
        str(before.get(key) or "").strip() != str(after.get(key) or "").strip()
        for key in _EVENT_NOTICE_FIELDS
    )
    if not changed:
        return
    try:
        emit_director_notification(
            kind="event_updated",
            title="Rendez-vous modifié",
            body=str(after.get("title") or "Rendez-vous")[:180],
            action_url=f"/gestion/planning/{after.get('id') or ''}",
        )
    except Exception:
        logger.warning("notification de rendez-vous non envoyée pour %s", after.get("id"), exc_info=True)


@router.put("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_event(event_id: str, body: EventUpdate):
    if body.event_type and body.event_type not in EVENT_TYPES:
        raise HTTPException(422, detail=f"event_type invalide — {EVENT_TYPES}")
    if body.status and body.status not in EVENT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {EVENT_STATUSES}")
    if body.modality is not None and body.modality not in EVENT_MODALITIES:
        raise HTTPException(422, detail="modality invalide — présentiel, visio ou async")
    if body.nature is not None and body.nature not in EVENT_NATURES:
        raise HTTPException(422, detail="nature invalide — presence ou matiere")
    if body.resource_type is not None and body.resource_type not in EVENT_RESOURCE_TYPES:
        raise HTTPException(422, detail="resource_type invalide — video, podcast ou document")
    if body.visibility is not None and body.visibility not in EVENT_VISIBILITIES:
        raise HTTPException(422, detail="visibility invalide — internal, selected, participants ou public")
    if body.visibility == "selected" and (
        (body.audience_user_ids is not None and not body.audience_user_ids)
        and (body.audience_contact_ids is not None and not body.audience_contact_ids)
        and not body.contact_id
    ):
        raise HTTPException(422, detail="Choisissez au moins un participant pour un accès nominatif.")
        raise HTTPException(422, detail="Choisissez au moins une personne pour un accès nominatif.")
    before = get_calendar_event(event_id)
    row = update_calendar_event(event_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Événement introuvable")
    if before:
        _notice_event_change(before, row)
    return row


@router.delete("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_event(event_id: str):
    if not delete_calendar_event(event_id):
        raise HTTPException(404, detail="Événement introuvable")
    return {"deleted": True}


class CrmFollowUpCompleteBody(BaseModel):
    snooze_days: int = Field(0, ge=0, le=30)


@router.post("/business/events/{event_id}/prepare-follow-up-email", dependencies=[Depends(resolve_tenant)])
async def business_prepare_follow_up_email(event_id: str):
    """Prépare un ticket e-mail HITL depuis une relance planning due."""
    result = prepare_follow_up_email_ticket(event_id)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Impossible de préparer la relance",
        )
    return result


@router.post("/business/events/{event_id}/complete-follow-up", dependencies=[Depends(resolve_tenant)])
async def business_complete_follow_up(event_id: str, body: CrmFollowUpCompleteBody | None = None):
    """Marque une relance CRM comme faite, ou la reporte (snooze_days)."""
    snooze = int((body.snooze_days if body else 0) or 0)
    result = complete_crm_follow_up(event_id, snooze_days=snooze)
    if not result.get("success"):
        raise HTTPException(
            status_code=int(result.get("status_code") or 400),
            detail=result.get("error") or "Impossible de clôturer la relance",
        )
    return result
