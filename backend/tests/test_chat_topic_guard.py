"""Garde-fou anti-dérive CRM hors sujet."""
from __future__ import annotations

from services.chat_surface import surface_chat_result
from services.chat_topic_guard import (
    crm_drift_score,
    guard_chat_reply,
    reply_is_crm_drift,
    user_invites_crm_topic,
)


def test_user_invites_crm_topic():
    assert user_invites_crm_topic("enrichis les contacts CRM")
    assert user_invites_crm_topic("où en est la prospection ?")
    assert not user_invites_crm_topic("corrige le contraste nocturne du QCM")
    assert not user_invites_crm_topic("simplifie l'UI mobile")


def test_crm_drift_detected_on_prospection_dump():
    reply = """## Synthèse décisionnelle
1. Valider 10 fiches CRM dans Décisions.

QUESTIONS STRATÉGIQUES DU CIO
1. Enrichir Irina Gondel ?
2. Lancer un playbook e-mail via /gestion/playbooks ?

#### LIVRABLE — Tableau de prospection
| Nom | Email |
"""
    assert crm_drift_score(reply) >= 2
    assert reply_is_crm_drift(reply, user_text="corrige le badge nocturne")
    safe, drifted = guard_chat_reply(
        reply,
        user_text="corrige le badge nocturne",
        agent_group_id="grp-core-fix",
    )
    assert drifted
    assert "prospection" not in safe.lower() or "écarté" in safe.lower()
    assert "fiches CRM" not in safe


def test_crm_reply_allowed_when_user_asks():
    reply = "Voici 3 prospects à relancer demain."
    safe, drifted = guard_chat_reply(reply, user_text="prépare la prospection LinkedIn")
    assert not drifted
    assert "prospects" in safe


def test_surface_applies_topic_guard():
    raw = """## Synthèse
Priorise le PWA.

QUESTIONS STRATÉGIQUES DU CIO
1. Valider le tableau de prospection ?
2. Enrichir via gestion_propose_contact_enrichment ?
"""
    out = surface_chat_result(
        raw,
        user_text="on avance sur le PWA",
        agent_group_id="grp-ui",
    )
    assert "PWA" in out or "écarté" in out.lower()
    assert "gestion_propose_contact" not in out
    assert "QUESTIONS STRATÉGIQUES" not in out
