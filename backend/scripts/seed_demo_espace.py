"""Jeu de projets + séances + ressources pour vérifier Mon espace / la vitrine."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from env_loader import load_backend_env

load_backend_env()

from config import settings
from tenant_context import set_tenant_context

TAG = "[DEMO ESPACE]"
WS = "ws-default-legacy"
ADMIN_EMAIL = (settings.bootstrap_admin_email or "eludinart@gmail.com").strip().lower()


def _iso(delta: timedelta) -> str:
    return (datetime.utcnow() + delta).replace(microsecond=0).isoformat()


def _wipe() -> None:
    from services.business_db import delete_calendar_event, delete_project, list_calendar_events, list_projects

    for ev in list_calendar_events(limit=500):
        if str(ev.get("title") or "").startswith(TAG):
            delete_calendar_event(str(ev["id"]))
    for prj in list_projects(limit=200):
        if str(prj.get("title") or "").startswith(TAG):
            delete_project(str(prj["id"]))


def _person() -> dict:
    from services.business_db import create_contact, find_contact_by_email

    existing = find_contact_by_email(ADMIN_EMAIL)
    if existing:
        return existing
    return create_contact(
        name="Éric Ludinart",
        email=ADMIN_EMAIL,
        contact_type="client",
        status="active",
        tags=["DEMO", "espace"],
        notes="Contact démo pour contenus nominatifs (Mon espace → Pour vous).",
    )


def _file(name: str, mime: str, body: bytes) -> str:
    from services.resource_files import save_upload

    saved = save_upload(filename=name, mime=mime, data=body)
    if not saved.get("success"):
        raise RuntimeError(saved.get("error") or "upload impossible")
    return str(saved["file"]["id"])


def main() -> None:
    set_tenant_context(workspace_id=WS)

    from services.business_db import create_calendar_event, create_project, init_business_tables

    init_business_tables()
    _wipe()
    person = _person()

    presence = create_project(
        title=f"{TAG} Présence — atelier & visio",
        contact_id=person["id"],
        description="Parcours A : dates en présentiel et à distance. Sert à vérifier Mes séances.",
        project_type="accompagnement",
        status="active",
        location="SÏvåñà / visio",
        start_date=_iso(timedelta(days=1))[:10],
        end_date=_iso(timedelta(days=40))[:10],
    )
    matiere = create_project(
        title=f"{TAG} Matière — modules à votre rythme",
        contact_id=person["id"],
        description="Parcours B : documents, vidéo, podcast. Sert à vérifier Mes ressources (consulter / télécharger).",
        project_type="module_pro",
        status="active",
        location="async",
        start_date=_iso(timedelta(days=-2))[:10],
        end_date=_iso(timedelta(days=30))[:10],
    )

    note = _file(
        "note-de-seance.txt",
        "text/plain",
        (
            "Note de séance — parcours démo Élude In Art\n\n"
            "Cette fiche vérifie la consultation dans Mon espace.\n"
            "- Présence : visio et atelier\n"
            "- Matière : document, vidéo, podcast\n"
        ).encode("utf-8"),
    )
    public_doc = _file(
        "invitation-ouverte.txt",
        "text/plain",
        "Invitation ouverte — visible sur la vitrine sans compte.\nRendez-vous à SÏvåñà, Tourves.\n".encode("utf-8"),
    )
    perso_doc = _file(
        "fiche-personnelle.txt",
        "text/plain",
        "Fiche nominative — uniquement pour le contact choisi (Pour vous).\n".encode("utf-8"),
    )

    events = [
        create_calendar_event(
            title=f"{TAG} Visio d’ouverture",
            starts_at=_iso(timedelta(days=3, hours=2)),
            ends_at=_iso(timedelta(days=3, hours=3)),
            event_type="visio",
            project_id=presence["id"],
            contact_id=person["id"],
            location="Lien visio (démo)",
            modality="visio",
            nature="presence",
            visibility="participants",
            notes="Séance pour tous les inscrits.",
        ),
        create_calendar_event(
            title=f"{TAG} Atelier SÏvåñà — ouvert à tous",
            starts_at=_iso(timedelta(days=12, hours=4)),
            ends_at=_iso(timedelta(days=12, hours=8)),
            event_type="atelier",
            project_id=presence["id"],
            location="SÏvåñà, Tourves",
            modality="presentiel",
            nature="presence",
            visibility="public",
            notes="Visible sur la vitrine sans compte.",
        ),
        create_calendar_event(
            title=f"{TAG} Séance individuelle",
            starts_at=_iso(timedelta(days=1, hours=5)),
            ends_at=_iso(timedelta(days=1, hours=6)),
            event_type="seance",
            project_id=presence["id"],
            contact_id=person["id"],
            location="visio",
            modality="visio",
            nature="presence",
            visibility="selected",
            audience_contact_ids=[person["id"]],
            notes="Uniquement pour le contact nominatif.",
        ),
        create_calendar_event(
            title=f"{TAG} Note de séance — document",
            starts_at=_iso(timedelta(hours=-6)),
            event_type="ressource",
            project_id=matiere["id"],
            nature="matiere",
            modality="async",
            resource_type="document",
            resource_file_id=note,
            visibility="participants",
            notes="Débloquée : Consulter + Télécharger.",
        ),
        create_calendar_event(
            title=f"{TAG} Module vidéo — Fleur d’ÅmÔurs",
            starts_at=_iso(timedelta(hours=-2)),
            event_type="ressource",
            project_id=matiere["id"],
            nature="matiere",
            modality="async",
            resource_type="video",
            resource_url="https://eludein.art",
            visibility="participants",
            notes="Lien externe pour les inscrits.",
        ),
        create_calendar_event(
            title=f"{TAG} Podcast — à venir",
            starts_at=_iso(timedelta(days=5)),
            event_type="ressource",
            project_id=matiere["id"],
            nature="matiere",
            modality="async",
            resource_type="podcast",
            resource_url="https://eludein.art",
            visibility="participants",
            notes="Doit apparaître dans Bientôt disponibles, sans lien.",
        ),
        create_calendar_event(
            title=f"{TAG} Invitation ouverte — document public",
            starts_at=_iso(timedelta(hours=-1)),
            event_type="ressource",
            project_id=matiere["id"],
            nature="matiere",
            modality="async",
            resource_type="document",
            resource_file_id=public_doc,
            visibility="public",
            notes="Visible vitrine + Mon espace (Ouvert à tous).",
        ),
        create_calendar_event(
            title=f"{TAG} Fiche personnelle",
            starts_at=_iso(timedelta(hours=-3)),
            event_type="ressource",
            project_id=matiere["id"],
            contact_id=person["id"],
            nature="matiere",
            modality="async",
            resource_type="document",
            resource_file_id=perso_doc,
            visibility="selected",
            audience_contact_ids=[person["id"]],
            notes="Pour vous uniquement.",
        ),
    ]

    print("workspace=ws-default-legacy")
    print(f"contact={person.get('id')} {person.get('email')}")
    print(f"project_presence={presence['id']}")
    print(f"project_matiere={matiere['id']}")
    print(f"events={len(events)}")
    print("espace=http://127.0.0.1:3000/a/eludein")
    print("planning=http://127.0.0.1:3000/gestion/planning")
    print("projets=http://127.0.0.1:3000/gestion/projets")


if __name__ == "__main__":
    main()
