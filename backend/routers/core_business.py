"""
routers/core_business.py — API gestion métier (contacts, projets, devis, planning, Tiime).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import resolve_tenant
from services.business_db import (
    CONTACT_STATUSES,
    CONTACT_TYPES,
    EVENT_STATUSES,
    EVENT_TYPES,
    INTERACTION_TYPES,
    INVOICE_STATUSES,
    PROJECT_STATUSES,
    PROJECT_TYPES,
    QUOTE_STATUSES,
    create_calendar_event,
    create_contact,
    create_external_invoice,
    create_project,
    create_quote,
    delete_calendar_event,
    delete_contact,
    delete_project,
    delete_quote,
    get_business_overview,
    get_calendar_event,
    get_contact,
    get_external_invoice,
    get_project,
    get_quote,
    list_calendar_events,
    list_contacts,
    list_external_invoices,
    list_interactions,
    list_projects,
    list_quotes,
    update_calendar_event,
    update_contact,
    update_external_invoice,
    update_project,
    update_quote,
)
from services.tiime_client import is_tiime_automation_configured, request_tiime_invoice

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


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    contact_type: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    notes: str | None = None


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


@router.delete("/business/contacts/{contact_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_contact(contact_id: str):
    if not delete_contact(contact_id):
        raise HTTPException(404, detail="Contact introuvable")
    return {"deleted": True}


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


@router.delete("/business/projects/{project_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_project(project_id: str):
    if not delete_project(project_id):
        raise HTTPException(404, detail="Projet introuvable")
    return {"deleted": True}


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
    return create_calendar_event(**body.model_dump())


@router.get("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_get_event(event_id: str):
    row = get_calendar_event(event_id)
    if not row:
        raise HTTPException(404, detail="Événement introuvable")
    return row


@router.put("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_update_event(event_id: str, body: EventUpdate):
    if body.event_type and body.event_type not in EVENT_TYPES:
        raise HTTPException(422, detail=f"event_type invalide — {EVENT_TYPES}")
    if body.status and body.status not in EVENT_STATUSES:
        raise HTTPException(422, detail=f"status invalide — {EVENT_STATUSES}")
    row = update_calendar_event(event_id, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, detail="Événement introuvable")
    return row


@router.delete("/business/events/{event_id}", dependencies=[Depends(resolve_tenant)])
async def business_delete_event(event_id: str):
    if not delete_calendar_event(event_id):
        raise HTTPException(404, detail="Événement introuvable")
    return {"deleted": True}
