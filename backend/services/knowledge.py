"""
services/knowledge.py — Graphe de connaissance des entités de la Fleur d'ÅmÔurs.

Stocke les entités clés (personnes, organisations, projets) dans une table SQLite dédiée.
Fournit build_entity_context_block() pour injecter le contexte pertinent dans les prompts.

Entités initiales : Sivana, Ti Spoun, Éric, Fleur d'ÅmÔurs.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from database import get_conn

logger = logging.getLogger(__name__)

# ── Entités fondatrices de l'écosystème ──────────────────────────────────────

_SEED_ENTITIES: list[dict[str, Any]] = [
    {
        "name": "Éric",
        "entity_type": "person",
        "attributes": {
            "role": "Créateur & dirigeant — Élude In Art",
            "localisation": "Tourves, 83170, Var",
            "email": "eludinart@gmail.com",
            "tel": "0659582428",
            "site": "eludein.art",
            "posture": "Entrepreneur individuel, accompagnateur systémique, artiste sonore (VIBRÆ)",
        },
        "relations": {
            "owns": ["Fleur d'ÅmÔurs", "SÏvåñà", "VIBRÆ"],
            "manages": ["Élude In Art"],
        },
    },
    {
        "name": "Fleur d'ÅmÔurs",
        "entity_type": "project",
        "attributes": {
            "type": "Tarot systémique — outil d'analyse relationnelle (65 cartes)",
            "posture": "Non divinatoire — cartographie des dynamiques",
            "familles": "8 formes d'amour / Cycle du Végétal / Cycles des Éléments / Cycle de la Vie",
            "cible": "Coachs, thérapeutes, facilitateurs, couples, professionnels de l'accompagnement",
            "business": "Vente physique pré-commande + séances individuelles + 7 Modules Pro + abonnements Stripe",
            "app": "app-fleurdamours.eludein.art",
        },
        "relations": {
            "created_by": ["Éric"],
            "distributed_through": ["Élude In Art"],
        },
    },
    {
        "name": "SÏvåñà",
        "entity_type": "project",
        "attributes": {
            "type": "Écolieu vivant — ancrage terrain dans le Haut-Var",
            "contrainte": "Toute stratégie doit rester exécutable in situ : ressources humaines, logistique locale limitée",
            "role_strategique": "Base opérationnelle pour stages, ateliers, retraites, constellations systémiques",
        },
        "relations": {
            "owned_by": ["Éric"],
            "supports": ["Fleur d'ÅmÔurs"],
        },
    },
    {
        "name": "Ti Spoun",
        "entity_type": "project",
        "attributes": {
            "type": "Ancrage local artisanal et relationnel",
            "contrainte": "Éviter les stratégies déconnectées de la capacité terrain réelle — rythme artisanal",
            "valeurs": "Authenticité, proximité, lien humain direct",
        },
        "relations": {
            "connected_to": ["SÏvåñà", "Éric"],
        },
    },
]

# ── Init table ────────────────────────────────────────────────────────────────

def init_knowledge_table() -> None:
    """Crée la table knowledge_entities et insère les entités fondatrices si absentes."""
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_entities (
                entity_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE,
                entity_type TEXT NOT NULL DEFAULT 'project',
                attributes_json TEXT NOT NULL DEFAULT '{}',
                relations_json  TEXT NOT NULL DEFAULT '{}',
                updated_at  TEXT NOT NULL
            )
        """)
        conn.commit()
    _seed_initial_entities()


def _seed_initial_entities() -> None:
    for entity in _SEED_ENTITIES:
        existing = get_entity(entity["name"])
        if existing is None:
            upsert_entity(
                name=entity["name"],
                entity_type=entity["entity_type"],
                attributes=entity["attributes"],
                relations=entity["relations"],
            )


# ── CRUD ──────────────────────────────────────────────────────────────────────

def upsert_entity(
    name: str,
    entity_type: str,
    attributes: dict[str, Any],
    relations: dict[str, Any],
) -> None:
    """Crée ou met à jour une entité dans le graphe."""
    now = datetime.utcnow().isoformat()
    name_clean = (name or "").strip()
    if not name_clean:
        raise ValueError("Le nom de l'entité est obligatoire.")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO knowledge_entities
                (name, entity_type, attributes_json, relations_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                name_clean,
                (entity_type or "project")[:32],
                json.dumps(attributes or {}, ensure_ascii=False),
                json.dumps(relations or {}, ensure_ascii=False),
                now,
            ),
        )
        conn.commit()


def get_entity(name: str) -> dict[str, Any] | None:
    """Récupère une entité par nom exact (insensible à la casse)."""
    name_clean = (name or "").strip()
    if not name_clean:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_entities WHERE lower(name) = lower(?)",
            (name_clean,),
        ).fetchone()
    if not row:
        return None
    return _hydrate_entity_row(dict(row))


def search_entities(query: str) -> list[dict[str, Any]]:
    """Recherche par correspondance partielle sur le nom, le type ou les attributs."""
    q = (query or "").strip().lower()
    if not q:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_entities ORDER BY updated_at DESC LIMIT 50",
        ).fetchall()
    results: list[dict[str, Any]] = []
    for row in rows or []:
        d = _hydrate_entity_row(dict(row))
        haystack = (
            d.get("name", "").lower()
            + " "
            + d.get("entity_type", "").lower()
            + " "
            + json.dumps(d.get("attributes", {}), ensure_ascii=False).lower()
        )
        if q in haystack:
            results.append(d)
    return results


def list_entities() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_entities ORDER BY entity_type, name"
        ).fetchall()
    return [_hydrate_entity_row(dict(row)) for row in (rows or [])]


def _hydrate_entity_row(d: dict[str, Any]) -> dict[str, Any]:
    try:
        d["attributes"] = json.loads(d.get("attributes_json") or "{}")
    except json.JSONDecodeError:
        d["attributes"] = {}
    try:
        d["relations"] = json.loads(d.get("relations_json") or "{}")
    except json.JSONDecodeError:
        d["relations"] = {}
    d.pop("attributes_json", None)
    d.pop("relations_json", None)
    return d


# ── Injection dans les prompts ────────────────────────────────────────────────

def build_entity_context_block(mission_text: str = "", *, max_entities: int = 6) -> str:
    """
    Construit un bloc de contexte entités à injecter dans le prompt d'un agent.
    Priorise les entités dont le nom apparaît dans le texte de la mission.
    """
    all_entities = list_entities()
    if not all_entities:
        return ""

    # Priorité : entités mentionnées dans la mission
    mission_lower = (mission_text or "").lower()
    prioritized: list[dict] = []
    rest: list[dict] = []
    for e in all_entities:
        if e["name"].lower() in mission_lower:
            prioritized.append(e)
        else:
            rest.append(e)

    selected = (prioritized + rest)[:max_entities]
    if not selected:
        return ""

    lines: list[str] = ["### Entités connues (Graphe Cognitif KORYMB)"]
    for e in selected:
        attrs = e.get("attributes") or {}
        attrs_str = " | ".join(f"{k}: {v}" for k, v in attrs.items() if v)
        rels = e.get("relations") or {}
        rels_str = "; ".join(f"{k}→{', '.join(v) if isinstance(v, list) else v}" for k, v in rels.items()) if rels else ""
        line = f"- **{e['name']}** ({e.get('entity_type', '?')}): {attrs_str}"
        if rels_str:
            line += f"\n  Relations: {rels_str}"
        lines.append(line)

    return "\n".join(lines) + "\n"
