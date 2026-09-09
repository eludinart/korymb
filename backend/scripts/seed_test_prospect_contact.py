"""Créer / mettre à jour le contact test prospection (email perso)."""
from __future__ import annotations

from env_loader import load_backend_env

load_backend_env()

from services.business_db import create_contact, find_contact_by_email, update_contact

EMAIL = "elude.in.art@gmail.com"

NOTES = """Profil cible pour tests prospection mail Korymb.
Activité : coach holistique / accompagnement émotionnel, sensibilisée au tarot symbolique et aux rituels de passage.
Angle Fleur d'ÅmÔurs : cartes + présence corporelle pour ateliers bien-être et stages week-end.
Source test : contact créé pour valider génération corps e-mail + HITL + sync Gmail."""

OUTREACH = """Bonjour Camille,

Je me permets de vous écrire après avoir découvert votre accompagnement autour du corps et de l'écoute émotionnelle.

Chez Élude In Art, nous proposons Fleur d'ÅmÔurs — un parcours tarot & présence qui peut enrichir vos ateliers (carte miroir, rituel d'ouverture, clôture symbolique). Plusieurs coachs et thérapeutes l'utilisent déjà pour marquer un temps fort sans alourdir leur cadre.

Seriez-vous ouverte à un échange de 20 minutes pour voir si cela pourrait servir vos prochains stages ?

Bien cordialement,
Élude In Art"""

PAYLOAD = {
    "name": "[TEST] Camille Moreau",
    "email": EMAIL,
    "phone": "06 12 34 56 78",
    "company": "Atelier Sève & Sens",
    "contact_type": "prospect",
    "status": "active",
    "tags": ["TEST", "coach", "thérapeute", "bien-être", "test-prospection"],
    "notes": NOTES,
    "outreach_suggestions": OUTREACH,
    "website": "https://exemple-atelier-seve-sens.fr",
    "linkedin_url": "https://www.linkedin.com/in/camille-moreau-exemple",
    "address": "12 rue des Lilas",
    "city": "Lyon",
    "postal_code": "69003",
    "socials": {
        "instagram": "https://instagram.com/atelier.seve.sens",
        "facebook": "",
        "resalib": "https://www.resalib.fr/praticien/exemple-camille-moreau",
    },
}


def main() -> None:
    existing = find_contact_by_email(EMAIL)
    if existing:
        fields = {k: v for k, v in PAYLOAD.items()}
        row = update_contact(existing["id"], **fields)
        action = "updated"
    else:
        row = create_contact(**PAYLOAD)
        action = "created"
    assert row
    print(action)
    print(f"id={row.get('id')}")
    print(f"name={row.get('name')}")
    print(f"email={row.get('email')}")
    print(f"tags={row.get('tags')}")
    print(f"url=http://127.0.0.1:3000/gestion/contacts/{row.get('id')}")


if __name__ == "__main__":
    main()
