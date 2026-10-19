"""Garde-fou anti-dérive CRM hors sujet."""
from __future__ import annotations

from services.chat_surface import surface_chat_result
from services.assistant_chat import messages_for_assistant
from services.chat_topic_guard import (
    crm_drift_score,
    guard_chat_reply,
    is_guard_fallback,
    reply_is_crm_drift,
    user_asks_product_ops,
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
    assert safe.strip()
    assert "écarté" not in safe.lower()
    assert not is_guard_fallback(safe)


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
    assert "PWA" in out
    assert "écarté" not in out.lower()
    assert "gestion_propose_contact" not in out
    assert "QUESTIONS STRATÉGIQUES" not in out


def test_korymb_priorities_keep_the_list_and_drop_the_prospecting_table():
    user = "Donne-moi 5 priorités concrètes pour aujourd'hui sur Korymb, sans questionnaire."
    assert user_asks_product_ops(user)
    reply = """Voici 5 priorités pour aujourd'hui :
1. Vérifier les missions en cours dans le cockpit
2. Traiter l'inbox ouverte
3. Relire le chat qui refuse de répondre
4. Contrôler le déploiement front

## Tableau de prospection
| Nom | Email |
| Coach Martin | a@b.c |
"""
    safe, drifted = guard_chat_reply(reply, user_text=user)
    assert "cockpit" in safe
    assert "écarté" not in safe.lower()
    assert "Relire le chat" in safe
    assert not is_guard_fallback(safe)
    assert not drifted or "prospection" in safe.lower()


def test_crm_answer_is_kept():
    reply = (
        "Tableau de prospection\n"
        "1. Relancer les contacts CRM\n"
        "2. Lancer un playbook e-mail\n"
    )
    safe, drifted = guard_chat_reply(
        reply,
        user_text="5 priorités aujourd'hui sur Korymb",
    )
    assert not drifted
    assert "Relancer les contacts" in safe
    assert "écarté" not in safe.lower()
    assert not is_guard_fallback(safe)


def test_refusal_is_not_replayed_as_history():
    refusal = (
        "Je me suis écarté du sujet (contenu CRM / prospection hors contexte). "
        "Reformulez votre demande — sans tableau de prospection."
    )
    assert is_guard_fallback(refusal)
    messages = messages_for_assistant(
        [
            {"role": "user", "content": "Donne-moi 5 priorités sur Korymb"},
            {"role": "assistant", "content": refusal},
        ],
        "Donne-moi 5 priorités concrètes pour aujourd'hui sur Korymb, sans questionnaire.",
    )
    assert len(messages) == 2
    assert all(m["role"] == "user" for m in messages)
    assert "écarté" not in messages[-1]["content"].lower()
