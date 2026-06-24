"""Audit de couverture et évolution d'activité — ancré dans la mémoire réelle du dirigeant."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import textwrap
from datetime import datetime, timezone
from typing import Any

from services.proposal_context import build_ecosystem_proposal_context, format_context_for_prompt

logger = logging.getLogger(__name__)

_GENERIC_TITLE_RE = re.compile(r"^proposition\s*\d+\s*$", re.I)

# operations = activité courante Élude In Art ; acquisition = reprise/cession (dormant sans contexte)
REPRISE_SCOPE_OPERATIONS = "operations"
REPRISE_SCOPE_ACQUISITION = "acquisition"

REPRISE_DOMAINS: list[dict[str, Any]] = [
    {
        "id": "gouvernance_juridique",
        "label": "Gouvernance & juridique",
        "scope": REPRISE_SCOPE_ACQUISITION,
        "description": "Structure légale, acte de cession, due diligence juridique (si reprise en cours).",
        "keywords": [
            "cession", "statuts", "pacte", "associé", "due diligence", "juridique",
            "contrat de cession", "garantie", "clause", "société", "reprise",
        ],
        "checklist": [
            "Identifier la forme juridique et les statuts actuels",
            "Préparer ou relire le projet d'acte de cession",
            "Lister les garanties et clauses de responsabilité",
            "Vérifier les engagements hors bilan et litiges en cours",
        ],
        "agents": ["coordinateur"],
    },
    {
        "id": "fiscal_comptable",
        "label": "Fiscal & comptable",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Micro-entreprise : TVA, facturation, devis, suivi courant (pas de due diligence lourde sauf reprise).",
        "keywords": [
            "fiscal", "comptable", "bilan", "tva", "liasse", "valorisation",
            "amortissement", "résultat", "expert-comptable", "isf", "impôt",
            "facture", "devis", "urssaf",
        ],
        "checklist": [
            "Tenir à jour facturation et devis clients",
            "Suivre échéances TVA et déclarations courantes",
            "Documenter le chiffre d'affaires et charges récurrentes",
            "Identifier les besoins comptables avant une éventuelle reprise",
        ],
        "agents": ["comptable"],
    },
    {
        "id": "social_rh",
        "label": "Social & RH",
        "scope": REPRISE_SCOPE_ACQUISITION,
        "description": "Contrats, masse salariale, obligations URSSAF (si reprise avec personnel).",
        "keywords": [
            "salarié", "contrat de travail", "urssaf", "rh", "personnel",
            "convention collective", "prud'hommes", "licenciement", "dsn",
        ],
        "checklist": [
            "Inventorier les contrats de travail et rémunérations",
            "Vérifier les déclarations sociales et dettes URSSAF",
            "Évaluer le transfert ou la restructuration des équipes",
            "Anticiper les obligations en cas de reprise du personnel",
        ],
        "agents": ["comptable", "coordinateur"],
    },
    {
        "id": "clients_contrats",
        "label": "Clients & contrats commerciaux",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Portefeuille clients, CGV, renouvellements.",
        "keywords": [
            "client", "contrat client", "cgv", "abonnement", "facturation",
            "churn", "portefeuille", "renouvellement", "devis",
        ],
        "checklist": [
            "Lister les 20 principaux clients et leur CA",
            "Relire les contrats clients à transférer ou renégocier",
            "Identifier les risques de résiliation liés à la cession",
            "Préparer un plan de communication clients post-reprise",
        ],
        "agents": ["commercial"],
    },
    {
        "id": "propriete_intellectuelle",
        "label": "Propriété intellectuelle",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Marques, droits d'auteur, licences logiciels et contenus.",
        "keywords": [
            "marque", "droit d'auteur", "licence", "propriété intellectuelle",
            "copyright", "brevet", "inpi", "cession de droits", "éditeur",
        ],
        "checklist": [
            "Inventorier marques, noms de domaine et dépôts INPI",
            "Cartographier les droits sur contenus et créations",
            "Vérifier les licences logicielles et contrats éditeurs",
            "Lister les cessions de droits en cours ou à négocier",
        ],
        "agents": ["commercial", "coordinateur"],
    },
    {
        "id": "editorial_tarot",
        "label": "Éditorial & éditeurs tarot",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Catalogue, relations éditeurs, droits sur les jeux.",
        "keywords": [
            "tarot", "éditeur", "cartes", "catalogue", "illustration",
            "deck", "oracle", "édition", "redevance", "droits éditeurs",
        ],
        "checklist": [
            "Lister les éditeurs partenaires et contrats en vigueur",
            "Clarifier qui détient les droits sur chaque jeu / deck",
            "Identifier les contrats à renégocier ou transférer",
            "Préparer une matrice éditeur × droits × redevances",
        ],
        "agents": ["commercial", "coordinateur"],
    },
    {
        "id": "commercial_marketing",
        "label": "Commercial & marketing",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Canaux de vente, tarification, pipeline.",
        "keywords": [
            "commercial", "marketing", "vente", "tarif", "pricing",
            "pipeline", "acquisition", "conversion", "campagne", "seo",
        ],
        "checklist": [
            "Cartographier les canaux de vente et leur performance",
            "Analyser la grille tarifaire et les marges",
            "Identifier les actions marketing à maintenir ou arrêter",
            "Définir les priorités commerciales des 90 premiers jours",
        ],
        "agents": ["commercial", "community_manager"],
    },
    {
        "id": "patrimoine_numerique",
        "label": "Patrimoine numérique & IT",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Site, bases de données, outils SaaS, accès techniques.",
        "keywords": [
            "site web", "hébergement", "saas", "api", "développement",
            "base de données", "serveur", "domaine", "github", "infrastructure",
        ],
        "checklist": [
            "Inventorier hébergements, domaines et accès administrateur",
            "Lister les abonnements SaaS et coûts récurrents",
            "Documenter l'architecture technique et les dépendances",
            "Planifier le transfert des accès et des sauvegardes",
        ],
        "agents": ["developpeur"],
    },
    {
        "id": "assurance_risques",
        "label": "Assurances & risques",
        "scope": REPRISE_SCOPE_ACQUISITION,
        "description": "RC pro, cyber, sinistres (si reprise ou changement de structure).",
        "keywords": [
            "assurance", "rc pro", "sinistre", "risque", "cyber",
            "responsabilité civile", "couverture", "franchise",
        ],
        "checklist": [
            "Recenser les polices d'assurance en cours",
            "Vérifier la couverture RC pro et cyber",
            "Identifier les sinistres ou litiges assurés",
            "Anticiper les changements de couverture post-reprise",
        ],
        "agents": ["coordinateur"],
    },
    {
        "id": "banque_tresorerie",
        "label": "Banque & trésorerie",
        "scope": REPRISE_SCOPE_ACQUISITION,
        "description": "Financement, cautions, transfert de comptes (si reprise ou levée de fonds).",
        "keywords": [
            "banque", "trésorerie", "financement", "emprunt", "crédit",
            "cash", "compte courant", "ligne de crédit", "fonds de roulement",
        ],
        "checklist": [
            "Analyser la trésorerie et le besoin en fonds de roulement",
            "Lister les comptes bancaires et mandats à transférer",
            "Évaluer les besoins de financement de la reprise",
            "Vérifier les cautions et garanties bancaires",
        ],
        "agents": ["comptable"],
    },
    {
        "id": "conformite_rgpd",
        "label": "Conformité & RGPD",
        "scope": REPRISE_SCOPE_OPERATIONS,
        "description": "Données personnelles, registre, consentements.",
        "keywords": [
            "rgpd", "données personnelles", "cnil", "consentement",
            "privacy", "registre", "dpo", "traitement",
        ],
        "checklist": [
            "Vérifier le registre des traitements et la politique privacy",
            "Identifier les sous-traitants et DPA en place",
            "Contrôler les bases clients et consentements marketing",
            "Planifier la mise en conformité post-reprise si nécessaire",
        ],
        "agents": ["developpeur", "coordinateur"],
    },
    {
        "id": "fournisseurs_dettes",
        "label": "Fournisseurs & dettes",
        "scope": REPRISE_SCOPE_ACQUISITION,
        "description": "Contrats fournisseurs, dettes, baux (si reprise d'un fonds ou structure).",
        "keywords": [
            "fournisseur", "dette", "créance", "engagement", "achat",
            "loyer", "bail", "facture fournisseur", "crédit fournisseur",
        ],
        "checklist": [
            "Lister les fournisseurs critiques et contrats en cours",
            "Cartographier dettes fournisseurs et échéances",
            "Vérifier les baux et engagements immobiliers",
            "Identifier les dépendances fournisseurs à risque",
        ],
        "agents": ["comptable", "coordinateur"],
    },
]


def _truncate(text: str, max_len: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _collect_corpus(ctx: dict[str, Any]) -> str:
    parts: list[str] = []

    contexts = ctx.get("memory_contexts") if isinstance(ctx.get("memory_contexts"), dict) else {}
    for k, v in contexts.items():
        if str(v or "").strip():
            parts.append(f"{k}: {v}")

    for r in ctx.get("recent_missions") or []:
        if isinstance(r, dict):
            parts.append(str(r.get("mission") or ""))
            parts.append(str(r.get("preview") or ""))

    for j in ctx.get("missions_digest") or []:
        if isinstance(j, dict):
            parts.append(str(j.get("mission") or ""))
            parts.append(str(j.get("result") or ""))

    for t in ctx.get("thread_excerpts") or []:
        if isinstance(t, dict):
            parts.append(str(t.get("mission") or ""))
            for msg in t.get("thread_tail") or []:
                if isinstance(msg, dict):
                    parts.append(str(msg.get("content") or ""))

    for p in ctx.get("pending_decisions") or []:
        if isinstance(p, dict):
            parts.append(str(p.get("title") or ""))
            for q in p.get("questions") or []:
                parts.append(str(q))

    return "\n".join(parts).lower()


def _checklist_coverage(corpus: str, items: list[str]) -> tuple[list[str], list[str]]:
    covered: list[str] = []
    missing: list[str] = []
    for item in items:
        tokens = [w for w in re.findall(r"[a-zàâäéèêëïîôùûüç0-9]{4,}", item.lower()) if len(w) >= 4]
        if not tokens:
            missing.append(item)
            continue
        hits = sum(1 for tok in tokens[:4] if tok in corpus)
        if hits >= max(1, len(tokens[:4]) // 2):
            covered.append(item)
        else:
            missing.append(item)
    return covered, missing


def _has_reprise_context(corpus: str) -> bool:
    return bool(re.search(r"reprise|cession|acquisition|transmission|due diligence", corpus))


def _format_director_reprise_decisions(actions: list[dict[str, Any]]) -> str:
    """Synthèse des choix dirigeant — à injecter dans les prompts pour ne pas reproposer l'éliminé."""
    ignored: list[str] = []
    deferred: list[str] = []
    validated: list[str] = []
    for row in actions or []:
        dom = str(row.get("domain_id") or "")
        item = str(row.get("item_text") or "").strip()
        act = str(row.get("action") or "")
        note = str(row.get("note") or "").strip()
        domain = _domain_by_id(dom) or {}
        label = domain.get("label") or dom
        line = f"- [{label}] {item}"
        if note:
            line += f" — {note}"
        if act == "ignored":
            ignored.append(line)
        elif act == "deferred":
            deferred.append(line)
        elif act in ("validated", "noted", "agent_launched"):
            validated.append(line)
    parts: list[str] = []
    if ignored:
        parts.append(
            "### Ignoré par le dirigeant (NE PAS reproposer — hors périmètre actuel)\n"
            + "\n".join(ignored[:40])
        )
    if deferred:
        parts.append(
            "### Reporté (ne pas proposer maintenant — revisiter plus tard)\n"
            + "\n".join(deferred[:30])
        )
    if validated:
        parts.append(
            "### Déjà couvert / validé (ne pas rouvrir sans demande)\n"
            + "\n".join(validated[:20])
        )
    return "\n\n".join(parts)


def _gaps_eligible_for_proposals(coverage: dict[str, Any]) -> list[dict[str, Any]]:
    """Lacunes actionnables : exclut domaines dormants, ignorés, sans point manquant réel."""
    out: list[dict[str, Any]] = []
    for g in coverage.get("gaps") or []:
        status = str(g.get("status") or "")
        if status in ("dormant", "not_applicable", "covered"):
            continue
        missing = [m for m in (g.get("checklist_missing") or []) if str(m).strip()]
        if not missing:
            continue
        entry = {**g, "checklist_missing": missing}
        out.append(entry)
    out.sort(key=lambda x: (0 if x.get("status") == "missing" else 1, x.get("label") or ""))
    return out


def _domain_status_after_actions(
    *,
    keyword_score: int,
    checklist_ratio: float,
    covered: list[str],
    missing: list[str],
    deferred: list[str],
    ignored: list[str],
) -> str:
    if covered and not missing and not deferred:
        return "covered"
    if not covered and not missing and ignored:
        return "not_applicable"
    if not missing and deferred and not covered:
        return "deferred"
    if keyword_score >= 3 and checklist_ratio >= 0.5:
        return "covered"
    if keyword_score >= 1 or checklist_ratio >= 0.25 or covered:
        return "partial"
    return "missing"


def _domain_by_id(domain_id: str) -> dict[str, Any] | None:
    for d in REPRISE_DOMAINS:
        if d.get("id") == domain_id:
            return d
    return None


def _action_key(domain_id: str, item_text: str) -> str:
    return f"{domain_id}::{item_text}"


def _merge_user_actions(coverage: dict[str, Any], actions: list[dict[str, Any]]) -> dict[str, Any]:
    """Fusionne les décisions dirigeant dans le scan (validation, notes, missions)."""
    if not actions:
        coverage["user_actions"] = {}
        return coverage

    by_key: dict[str, dict[str, Any]] = {}
    for row in actions:
        dom = str(row.get("domain_id") or "")
        item = str(row.get("item_text") or "")
        if dom and item:
            by_key[_action_key(dom, item)] = row
    coverage["user_actions"] = by_key

    domains_out: list[dict[str, Any]] = []
    for domain in coverage.get("domains") or []:
        dom_id = domain.get("id") or ""
        covered = list(domain.get("checklist_covered") or [])
        missing = list(domain.get("checklist_missing") or [])
        deferred: list[str] = []
        ignored: list[str] = []
        item_notes: list[dict[str, str]] = []

        for item in list(covered) + list(missing):
            row = by_key.get(_action_key(dom_id, item))
            if not row:
                continue
            act = str(row.get("action") or "")
            note = str(row.get("note") or "").strip()
            if act == "validated" and item in missing:
                missing.remove(item)
                if item not in covered:
                    covered.append(item)
            elif act == "deferred":
                if item in missing:
                    missing.remove(item)
                if item in covered:
                    covered.remove(item)
                if item not in deferred:
                    deferred.append(item)
            elif act == "ignored":
                if item in missing:
                    missing.remove(item)
                if item in covered:
                    covered.remove(item)
                if item not in ignored:
                    ignored.append(item)
            if note:
                item_notes.append({"item": item, "note": note, "action": act})

        total_items = len(covered) + len(missing)
        checklist_ratio = len(covered) / max(1, total_items) if total_items else 0.0
        keyword_score = len(domain.get("keyword_hits") or [])
        base_status = str(domain.get("status") or "missing")
        if base_status == "dormant":
            status = "dormant"
        else:
            status = _domain_status_after_actions(
                keyword_score=keyword_score,
                checklist_ratio=checklist_ratio,
                covered=covered,
                missing=missing,
                deferred=deferred,
                ignored=ignored,
            )

        entry = {**domain, "status": status, "checklist_covered": covered, "checklist_missing": missing}
        if deferred:
            entry["checklist_deferred"] = deferred
        if ignored:
            entry["checklist_ignored"] = ignored
        if item_notes:
            entry["item_notes"] = item_notes
        domains_out.append(entry)

    gaps = [
        {**d, "priority": 0 if d["status"] == "missing" else 1}
        for d in domains_out
        if d.get("status") not in ("covered", "dormant", "not_applicable", "deferred")
    ]
    gaps.sort(key=lambda g: (g.get("priority", 9), g.get("label") or ""))
    active_domains = [d for d in domains_out if d.get("status") not in ("dormant", "not_applicable")]
    covered_n = sum(1 for d in active_domains if d["status"] == "covered")
    partial_n = sum(1 for d in active_domains if d["status"] == "partial")
    missing_n = sum(1 for d in active_domains if d["status"] == "missing")
    dormant_n = sum(1 for d in domains_out if d["status"] == "dormant")
    not_applicable_n = sum(1 for d in domains_out if d["status"] == "not_applicable")

    coverage["domains"] = domains_out
    coverage["gaps"] = gaps
    coverage["coverage_score"] = round(covered_n / max(1, len(active_domains)), 2) if active_domains else 1.0
    coverage["summary"] = {
        "total_domains": len(domains_out),
        "active_domains": len(active_domains),
        "covered": covered_n,
        "partial": partial_n,
        "missing": missing_n,
        "dormant": dormant_n,
        "not_applicable": not_applicable_n,
    }
    return coverage


_AGENT_MEMORY_CONTEXT: dict[str, str] = {
    "coordinateur": "global",
    "commercial": "commercial",
    "comptable": "comptable",
    "developpeur": "developpeur",
    "community_manager": "community_manager",
}


def _memory_context_keys_for_domain(domain: dict[str, Any] | None) -> list[str]:
    keys: list[str] = ["global"]
    for agent in (domain or {}).get("agents") or []:
        ctx_key = _AGENT_MEMORY_CONTEXT.get(str(agent))
        if ctx_key and ctx_key not in keys:
            keys.append(ctx_key)
    return keys


def _format_reprise_memory_line(*, label: str, item_text: str, note: str, action: str) -> str:
    line = f"[Reprise — {label}] {item_text}"
    if note.strip():
        line += f" — {note.strip()}"
    if action == "validated":
        line += " (validé par le dirigeant)"
    elif action == "deferred":
        line += " (reporté — pas pour maintenant)"
    elif action == "ignored":
        line += " (ignoré par le dirigeant — hors périmètre actuel, ne pas reproposer)"
    elif action == "agent_launched":
        line += " (mission agents lancée)"
    elif action == "agent_relaunch":
        line += " (relance agents — point déjà suivi)"
    return line


def _append_reprise_note_to_memory(*, domain_id: str, item_text: str, note: str, action: str) -> list[str]:
    """Enrichit le contexte global et les volets métiers liés au domaine reprise."""
    from database import get_enterprise_memory, merge_enterprise_contexts, _memory_context_allowed_keys

    domain = _domain_by_id(domain_id)
    label = (domain or {}).get("label") or domain_id
    line = _format_reprise_memory_line(label=label, item_text=item_text, note=note, action=action)
    target_keys = [k for k in _memory_context_keys_for_domain(domain) if k in _memory_context_allowed_keys()]
    mem = get_enterprise_memory()
    contexts = dict(mem.get("contexts") or {})
    updates: dict[str, str] = {}
    for key in target_keys:
        cur = str(contexts.get(key) or "").strip()
        updates[key] = "\n".join(x for x in [cur, line] if x.strip())[:50_000]
    merge_enterprise_contexts(updates)
    return target_keys


def _build_checklist_mission_text(
    *,
    domain_id: str,
    item_text: str,
    note: str = "",
    relaunch: bool = False,
) -> tuple[str, list[str], str]:
    domain = _domain_by_id(domain_id) or {}
    agents = domain.get("agents") or ["coordinateur"]
    label = domain.get("label") or domain_id
    agents_line = ", ".join(agents)
    relaunch_line = (
        "Contexte : ce point a déjà été validé ou suivi par le dirigeant — approfondir, "
        "mettre à jour la synthèse et enrichir la mémoire entreprise.\n"
        if relaunch
        else ""
    )
    mission_body = (
        f"Mission reprise d'entreprise — domaine : {label}\n"
        f"Point checklist : {item_text}\n"
        f"{relaunch_line}"
        f"Agents recommandés pour ce sujet : {agents_line}\n"
    )
    if note.strip():
        mission_body += f"Précisions dirigeant (à intégrer au contexte entreprise) : {note.strip()}\n"
    mission_body += (
        "\nObjectif : traiter ce point de la checklist reprise et produire une synthèse actionnable.\n"
        "Livrables attendus :\n"
        "- État des lieux documenté sur le point\n"
        "- Risques, dépendances et échéances identifiés\n"
        "- Recommandations concrètes pour la reprise\n"
        "- Éléments à persister dans la mémoire entreprise (global + volets métiers concernés)\n"
        "\nCritère de succès : le dirigeant peut valider que le point est couvert et que le contexte "
        "entreprise est enrichi."
    )
    return mission_body, agents, label


def scan_reprise_coverage(ctx: dict[str, Any] | None = None) -> dict[str, Any]:
    """Analyse le contexte écosystème vs checklist reprise — sans appel LLM."""
    from database import list_reprise_checklist_actions

    ecosystem = ctx or build_ecosystem_proposal_context(max_chars=14_000)
    corpus = _collect_corpus(ecosystem)
    has_reprise = _has_reprise_context(corpus)

    domains_out: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []

    for domain in REPRISE_DOMAINS:
        scope = str(domain.get("scope") or REPRISE_SCOPE_OPERATIONS)
        keywords = domain.get("keywords") or []
        hits = [k for k in keywords if k.lower() in corpus]
        checklist = domain.get("checklist") or []
        covered_items, missing_items = _checklist_coverage(corpus, checklist)

        checklist_ratio = len(covered_items) / max(1, len(checklist))
        keyword_score = len(hits)

        if scope == REPRISE_SCOPE_ACQUISITION and not has_reprise:
            status = "dormant"
            dormant_reason = (
                "Hors périmètre actuel : aucune reprise/cession documentée en mémoire. "
                "Ce domaine réapparaîtra si vous enrichissez le contexte global."
            )
        elif keyword_score >= 3 and checklist_ratio >= 0.5:
            status = "covered"
            dormant_reason = ""
        elif keyword_score >= 1 or checklist_ratio >= 0.25:
            status = "partial"
            dormant_reason = ""
        else:
            status = "missing"
            dormant_reason = ""

        entry = {
            "id": domain["id"],
            "label": domain["label"],
            "description": domain.get("description") or "",
            "scope": scope,
            "status": status,
            "keyword_hits": hits[:6],
            "checklist_covered": covered_items,
            "checklist_missing": missing_items,
            "suggested_agents": domain.get("agents") or ["coordinateur"],
        }
        if dormant_reason:
            entry["dormant_reason"] = dormant_reason
        domains_out.append(entry)

        if status not in ("covered", "dormant"):
            gaps.append({
                **entry,
                "priority": 0 if status == "missing" else 1,
            })

    gaps.sort(key=lambda g: (g.get("priority", 9), g.get("label") or ""))
    active_domains = [d for d in domains_out if d.get("status") != "dormant"]
    covered_n = sum(1 for d in active_domains if d["status"] == "covered")
    partial_n = sum(1 for d in active_domains if d["status"] == "partial")
    missing_n = sum(1 for d in active_domains if d["status"] == "missing")
    dormant_n = sum(1 for d in domains_out if d["status"] == "dormant")

    result = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "coverage_score": round(covered_n / max(1, len(active_domains)), 2) if active_domains else 1.0,
        "summary": {
            "total_domains": len(domains_out),
            "active_domains": len(active_domains),
            "covered": covered_n,
            "partial": partial_n,
            "missing": missing_n,
            "dormant": dormant_n,
        },
        "domains": domains_out,
        "gaps": gaps,
        "has_reprise_context": has_reprise,
    }
    actions = list_reprise_checklist_actions()
    merged = _merge_user_actions(result, actions)
    merged["director_decisions_summary"] = _format_director_reprise_decisions(actions)
    return merged


def record_reprise_item_action(
    *,
    domain_id: str,
    item_text: str,
    action: str,
    note: str = "",
) -> dict[str, Any]:
    """Enregistre une décision dirigeant sur un point checklist et met à jour la mémoire."""
    from database import upsert_reprise_checklist_action

    item = (item_text or "").strip()
    if not item:
        raise ValueError("item_text requis")
    if action not in ("validated", "noted", "deferred", "ignored"):
        raise ValueError(f"action non supportée : {action}")

    row = upsert_reprise_checklist_action(
        domain_id=domain_id,
        item_text=item,
        action=action,
        note=note,
    )
    memory_keys: list[str] = []
    if action in ("validated", "noted", "ignored", "deferred") or note.strip():
        memory_keys = _append_reprise_note_to_memory(
            domain_id=domain_id,
            item_text=item,
            note=note,
            action=action,
        )
    coverage = scan_reprise_coverage()
    return {"action": row, "coverage": coverage, "memory_contexts_updated": memory_keys}


def reopen_reprise_item(*, domain_id: str, item_text: str) -> dict[str, Any]:
    """Réaffiche un point ignoré ou reporté en supprimant la décision dirigeant."""
    from database import delete_reprise_checklist_action

    item = (item_text or "").strip()
    if not item:
        raise ValueError("item_text requis")
    delete_reprise_checklist_action(domain_id, item)
    return {"reopened": True, "coverage": scan_reprise_coverage()}


def create_missions_from_checklist_items(
    items: list[dict[str, str]],
) -> dict[str, Any]:
    """Crée des propositions de mission pour des points checklist sélectionnés."""
    import json as _json

    from database import create_autonomous_output, upsert_reprise_checklist_action
    from services.cost_estimate import estimate_mission_cost

    if not items:
        raise ValueError("Aucun point sélectionné")

    staged: list[tuple[dict[str, str], str, str, str]] = []
    outputs: list[dict] = []

    for raw in items[:10]:
        domain_id = str(raw.get("domain_id") or "").strip()
        item_text = str(raw.get("item_text") or "").strip()
        note = str(raw.get("note") or "").strip()
        if not domain_id or not item_text:
            continue
        mission_body, agents, label = _build_checklist_mission_text(
            domain_id=domain_id,
            item_text=item_text,
            note=note,
        )
        est = estimate_mission_cost(mission=mission_body, agents=agents, mode="cio")
        title = item_text if len(item_text) <= 120 else item_text[:117] + "…"
        blob = {
            "description": mission_body,
            "why_now": f"Lacune reprise — {label}",
            "agents": agents,
            "proposed_by_agent": str(agents[0] if agents else "coordinateur"),
            "source_kind": "reprise_checklist",
            "source_job_id": domain_id,
            "source_label": f"Checklist reprise — {label}",
            "reprise_domain": domain_id,
            "checklist_items_addressed": [item_text],
            "estimated_tokens": est.get("estimated_tokens"),
            "estimated_cost_usd": est.get("estimated_cost_usd"),
            "risk_flags": [],
            "launch_mode": "supervised",
        }
        staged.append(
            (
                {"title": title, "content": _json.dumps(blob, ensure_ascii=False)},
                domain_id,
                item_text,
                note,
            ),
        )

    for proposal, domain_id, item_text, note in staged:
        out = create_autonomous_output(
            task_id="reprise-checklist",
            output_type="mission_proposal",
            title=proposal["title"],
            content=proposal["content"],
        )
        outputs.append(out)
        upsert_reprise_checklist_action(
            domain_id=domain_id,
            item_text=item_text,
            action="mission_pending",
            note=note,
            output_id=str(out.get("id") or ""),
        )

    if outputs:
        try:
            from services.director_platform import emit_director_notification

            emit_director_notification(
                kind="scheduler_output",
                title=f"{len(outputs)} mission(s) reprise à valider",
                body="Points checklist transformés en propositions — à approuver dans Approbations.",
                action_url="/administration/approbations",
            )
        except Exception:
            pass

    return {
        "created": len(outputs),
        "outputs": outputs,
        "coverage": scan_reprise_coverage(),
        "message": f"{len(outputs)} mission(s) proposée(s) pour les points sélectionnés.",
    }


async def launch_agents_from_checklist_items(
    items: list[dict[str, str]],
    *,
    launch_mode: str = "supervised",
) -> dict[str, Any]:
    """Lance immédiatement les agents sur des points checklist et alimente la mémoire."""
    import uuid

    from database import get_reprise_checklist_action, upsert_reprise_checklist_action
    from scheduler import _CaptureBT
    from services.mission import _mission_config_from_payload, _schedule_mission_execution

    if not items:
        raise ValueError("Aucun point sélectionné")

    mode = str(launch_mode or "supervised").strip().lower()
    if mode not in ("supervised", "autonomous"):
        raise ValueError("launch_mode invalide (supervised|autonomous)")

    launched: list[dict[str, Any]] = []
    memory_keys_all: list[str] = []
    _RELAUNCH_PRIOR = frozenset({"validated", "noted", "agent_launched", "deferred"})

    for raw in items[:5]:
        domain_id = str(raw.get("domain_id") or "").strip()
        item_text = str(raw.get("item_text") or "").strip()
        note = str(raw.get("note") or "").strip()
        if not domain_id or not item_text:
            continue

        prior = get_reprise_checklist_action(domain_id, item_text)
        relaunch = bool(prior and str(prior.get("action") or "") in _RELAUNCH_PRIOR)

        mission_body, agents, label = _build_checklist_mission_text(
            domain_id=domain_id,
            item_text=item_text,
            note=note,
            relaunch=relaunch,
        )
        memory_keys = _append_reprise_note_to_memory(
            domain_id=domain_id,
            item_text=item_text,
            note=note,
            action="agent_relaunch" if relaunch else "agent_launched",
        )
        memory_keys_all.extend(memory_keys)

        job_id = str(uuid.uuid4())[:8]
        supervised = mode != "autonomous"
        cfg = _mission_config_from_payload({
            "require_user_validation": supervised,
            "mode": "cio",
            "cio_plan_hitl_enabled": supervised,
            "cio_questions_enabled": supervised,
        })
        context = {
            "reprise_domain": domain_id,
            "reprise_label": label,
            "checklist_item": item_text,
            "recommended_agents": agents,
            "director_note": note,
            "memory_contexts": memory_keys,
            "relaunch": relaunch,
        }
        bt = _CaptureBT()
        _schedule_mission_execution(
            bt,
            job_id,
            "coordinateur",
            mission_body,
            context,
            "reprise_checklist",
            mission_config=cfg,
        )
        loop = asyncio.get_event_loop()
        for func, args, kwargs in bt._tasks:
            loop.run_in_executor(None, lambda f=func, a=args, k=kwargs: f(*a, **k))

        upsert_reprise_checklist_action(
            domain_id=domain_id,
            item_text=item_text,
            action="agent_launched",
            note=note,
            output_id=job_id,
        )
        launched.append({
            "job_id": job_id,
            "domain_id": domain_id,
            "item_text": item_text,
            "agents": agents,
            "memory_contexts_updated": memory_keys,
            "relaunch": relaunch,
        })
        try:
            from services.director_platform import emit_director_notification

            emit_director_notification(
                kind="info",
                title=f"{'Relance' if relaunch else 'Mission'} reprise — {label}",
                body=f"Point : {item_text[:120]} · Agents : {', '.join(agents)}",
                job_id=job_id,
                action_url=f"/missions?job={job_id}",
            )
        except Exception:
            pass

    if not launched:
        raise ValueError("Aucun point valide à lancer")

    return {
        "launched": len(launched),
        "jobs": launched,
        "memory_contexts_updated": sorted(set(memory_keys_all)),
        "coverage": scan_reprise_coverage(),
        "message": (
            f"{len(launched)} mission(s) lancée(s) — suivez l'exécution dans Missions. "
            f"Mémoire enrichie : {', '.join(sorted(set(memory_keys_all)))}."
        ),
    }


def _format_gaps_for_prompt(gaps: list[dict[str, Any]], limit: int = 8) -> str:
    lines: list[str] = []
    for g in gaps[:limit]:
        missing = g.get("checklist_missing") or []
        lines.append(f"### {g.get('label')} [{g.get('status')}]")
        if missing:
            lines.append("Points non couverts :")
            for m in missing[:4]:
                lines.append(f"  - {m}")
        if g.get("keyword_hits"):
            lines.append(f"Indices trouvés : {', '.join(g['keyword_hits'][:4])}")
        lines.append("")
    return "\n".join(lines) or "(aucune lacune identifiée)"


def _is_generic_title(title: str) -> bool:
    t = (title or "").strip()
    if _GENERIC_TITLE_RE.match(t):
        return True
    if len(t) < 8:
        return True
    return False


def _is_generic_proposal(title: str, content: str) -> bool:
    if _is_generic_title(title):
        return True
    if len((content or "").strip()) < 60:
        return True
    return False


def _generate_reprise_proposals_sync(
    *,
    nb_proposals: int,
    gaps: list[dict[str, Any]],
    context_block: str,
    director_decisions: str,
    task_id: str,
) -> list[dict]:
    try:
        from llm_client import llm_turn
        from services.agents import FLEUR_CONTEXT
        from services.cost_estimate import estimate_mission_cost

        gaps_block = _format_gaps_for_prompt(gaps)
        target = min(nb_proposals, max(1, len(gaps)))
        decisions_block = director_decisions.strip() or "(aucune décision enregistrée)"

        prompt = textwrap.dedent(f"""
            Tu es le CIO d'Élude In Art (micro-entreprise, Tarot Fleur d'Amour, activité réelle du dirigeant).
            Tu dois proposer exactement {target} missions CONCRÈTES et ANCRÉES — pas de titres génériques
            (« Proposition 1 », « Mission test », etc. interdits).

            {FLEUR_CONTEXT}

            --- CONTEXTE FACTUEL (mémoire, missions, décisions) ---
            {context_block}
            --- FIN CONTEXTE ---

            --- DÉCISIONS DU DIRIGEANT (à respecter strictement) ---
            {decisions_block}
            --- FIN DÉCISIONS ---

            --- LACUNES ACTIONNABLES (checklist non couverte, déjà filtrée) ---
            {gaps_block}
            --- FIN LACUNES ---

            Règles impératives :
            1. N'invente RIEN qui ne soit pas soutenu par le contexte factuel ci-dessus.
            2. Ne propose JAMAIS un sujet listé comme ignoré ou reporté par le dirigeant.
            3. Pas d'anticipation « reprise M&A » (cautions bancaires, due diligence RH, valorisation)
               sauf si c'est explicitement documenté dans la mémoire ou une lacune acquisition active.
            4. Chaque mission doit combler un point checklist_missing listé — titre actionnable et spécifique
               à l'activité actuelle (éditorial tarot, commercial, IT, clients…).
            5. Le champ content : objectif, livrables (3-5 puces), critère de succès — uniquement faisable maintenant.
            6. Renseigne reprise_domain et checklist_items_addressed.
            7. source_kind = "reprise_gap", source_label = phrase courte factuelle.
            8. Mobilise le minimum d'agents nécessaires (souvent coordinateur seul).
            9. Si le contexte est trop pauvre pour une lacune, ne propose pas de mission pour ce point.

            Réponds UNIQUEMENT avec un JSON (tableau) :
            [
              {{
                "title": "Titre concret et spécifique",
                "content": "Objectif…\\nLivrables :\\n- …\\n- …\\nCritère de succès : …",
                "why_now": "Pourquoi c'est bloquant pour la reprise",
                "agents": ["commercial"],
                "reprise_domain": "editorial_tarot",
                "checklist_items_addressed": ["Lister les éditeurs partenaires"],
                "source_kind": "reprise_gap",
                "source_label": "Lacune éditeurs tarot non couverte",
                "risk_flags": [],
                "launch_mode": "supervised"
              }}
            ]
        """).strip()

        result, _, _ = llm_turn(
            prompt,
            max_tokens=2400,
            or_profile="standard",
            usage_context=f"reprise-audit:{task_id}",
        )
        result = (result or "").strip()
        start = result.find("[")
        end = result.rfind("]") + 1
        if start == -1 or end == 0:
            return []

        raw = json.loads(result[start:end])
        if not isinstance(raw, list):
            return []

        enriched: list[dict] = []
        for p in raw:
            if not isinstance(p, dict):
                continue
            title = str(p.get("title") or "").strip()
            mission_text = str(p.get("content") or "").strip()
            if _is_generic_proposal(title, mission_text):
                continue
            agents = p.get("agents") if isinstance(p.get("agents"), list) else ["coordinateur"]
            est = estimate_mission_cost(mission=mission_text, agents=agents, mode="cio")
            blob = {
                "description": mission_text,
                "why_now": str(p.get("why_now") or ""),
                "agents": agents,
                "proposed_by_agent": str(agents[0] if agents else "coordinateur"),
                "source_kind": "reprise_gap",
                "source_job_id": str(p.get("reprise_domain") or ""),
                "source_label": str(p.get("source_label") or p.get("reprise_domain") or "Audit reprise"),
                "reprise_domain": str(p.get("reprise_domain") or ""),
                "checklist_items_addressed": (
                    p.get("checklist_items_addressed")
                    if isinstance(p.get("checklist_items_addressed"), list)
                    else []
                ),
                "estimated_tokens": est.get("estimated_tokens"),
                "estimated_cost_usd": est.get("estimated_cost_usd"),
                "risk_flags": p.get("risk_flags") if isinstance(p.get("risk_flags"), list) else [],
                "launch_mode": str(p.get("launch_mode") or "supervised"),
            }
            enriched.append({
                "title": title,
                "content": json.dumps(blob, ensure_ascii=False),
            })
            if len(enriched) >= target:
                break
        return enriched
    except Exception as exc:
        logger.error("Génération propositions reprise échouée : %s", exc)
        return []


async def run_reprise_audit(
    *,
    nb_proposals: int = 5,
    generate_proposals: bool = True,
) -> dict[str, Any]:
    """Scan complet + génération optionnelle de missions ancrées dans la réalité du dirigeant."""
    ctx = build_ecosystem_proposal_context(max_chars=14_000)
    coverage = scan_reprise_coverage(ctx)
    gaps = _gaps_eligible_for_proposals(coverage)
    director_decisions = str(coverage.get("director_decisions_summary") or "")

    result: dict[str, Any] = {
        "coverage": coverage,
        "created": 0,
        "outputs": [],
        "message": "",
    }

    if not generate_proposals:
        result["message"] = (
            f"{len(gaps)} lacune(s) actionnable(s) — "
            f"{coverage.get('summary', {}).get('dormant', 0)} domaine(s) en veille (hors périmètre actuel)."
        )
        return result

    if not gaps:
        dormant = int(coverage.get("summary", {}).get("dormant", 0) or 0)
        result["message"] = (
            "Aucune lacune actionnable — enrichissez la mémoire sur votre activité courante, "
            "ou ignorez explicitement les points non pertinents."
            + (f" {dormant} domaine(s) acquisition en veille (pas de reprise documentée)." if dormant else "")
        )
        return result

    context_block = format_context_for_prompt(ctx)
    loop = asyncio.get_event_loop()
    proposals = await loop.run_in_executor(
        None,
        lambda: _generate_reprise_proposals_sync(
            nb_proposals=nb_proposals,
            gaps=gaps,
            context_block=context_block,
            director_decisions=director_decisions,
            task_id="reprise-audit",
        ),
    )

    if not proposals:
        result["message"] = (
            "Scan terminé — aucune proposition pertinente générée (contexte insuffisant ou lacunes déjà arbitrées). "
            "Enrichissez la mémoire entreprise avec des faits réels, puis relancez."
        )
        return result

    from services.veille import _persist_mission_proposals

    outputs = _persist_mission_proposals("reprise-audit", proposals)
    result["created"] = len(outputs)
    result["outputs"] = outputs
    result["message"] = f"{len(outputs)} mission(s) proposée(s) — ancrées dans votre contexte actuel."
    return result
