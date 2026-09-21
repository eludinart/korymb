"""
services/knowledge.py — Graphe de connaissance des entités (scopé workspace).

Seed Élude / Fleur uniquement pour le workspace legacy.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from database import get_conn
from services.workspace_brand import LEGACY_ELUDE_WORKSPACE_ID, is_legacy_elude_workspace

logger = logging.getLogger(__name__)

_SEED_ENTITIES_ELUDE: list[dict[str, Any]] = [
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


def _ws() -> str:
    try:
        from workspace_db import ws_id

        return (ws_id() or LEGACY_ELUDE_WORKSPACE_ID).strip() or LEGACY_ELUDE_WORKSPACE_ID
    except Exception:
        return LEGACY_ELUDE_WORKSPACE_ID


def init_knowledge_table() -> None:
    """Crée la table knowledge_entities et seed legacy si besoin."""
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_entities (
                entity_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                entity_type TEXT NOT NULL DEFAULT 'project',
                attributes_json TEXT NOT NULL DEFAULT '{}',
                relations_json  TEXT NOT NULL DEFAULT '{}',
                updated_at  TEXT NOT NULL,
                workspace_id TEXT
            )
            """
        )
        try:
            from workspace_db import ensure_workspace_columns

            ensure_workspace_columns(conn)
        except Exception:
            pass
        conn.commit()
    _seed_initial_entities()


def _seed_initial_entities() -> None:
    if not is_legacy_elude_workspace():
        return
    for entity in _SEED_ENTITIES_ELUDE:
        existing = get_entity(entity["name"])
        if existing is None:
            upsert_entity(
                name=entity["name"],
                entity_type=entity["entity_type"],
                attributes=entity["attributes"],
                relations=entity["relations"],
            )


def _hydrate_entity_row(d: dict[str, Any]) -> dict[str, Any]:
    try:
        attrs = json.loads(d.get("attributes_json") or "{}")
    except Exception:
        attrs = {}
    try:
        rels = json.loads(d.get("relations_json") or "{}")
    except Exception:
        rels = {}
    return {
        "entity_id": d.get("entity_id"),
        "name": d.get("name"),
        "entity_type": d.get("entity_type"),
        "attributes": attrs if isinstance(attrs, dict) else {},
        "relations": rels if isinstance(rels, dict) else {},
        "updated_at": d.get("updated_at"),
        "workspace_id": d.get("workspace_id"),
    }


def upsert_entity(
    name: str,
    entity_type: str,
    attributes: dict[str, Any],
    relations: dict[str, Any],
) -> None:
    now = datetime.utcnow().isoformat()
    name_clean = (name or "").strip()
    if not name_clean:
        raise ValueError("Le nom de l'entité est obligatoire.")
    wid = _ws()
    with get_conn() as conn:
        prev = conn.execute(
            "SELECT entity_id FROM knowledge_entities WHERE lower(name) = lower(?) AND workspace_id = ?",
            (name_clean, wid),
        ).fetchone()
        if prev:
            eid = dict(prev).get("entity_id") if isinstance(prev, dict) else prev[0]
            conn.execute(
                """
                UPDATE knowledge_entities
                SET entity_type=?, attributes_json=?, relations_json=?, updated_at=?
                WHERE entity_id=?
                """,
                (
                    (entity_type or "project")[:32],
                    json.dumps(attributes or {}, ensure_ascii=False),
                    json.dumps(relations or {}, ensure_ascii=False),
                    now,
                    eid,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO knowledge_entities
                    (name, entity_type, attributes_json, relations_json, updated_at, workspace_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    name_clean,
                    (entity_type or "project")[:32],
                    json.dumps(attributes or {}, ensure_ascii=False),
                    json.dumps(relations or {}, ensure_ascii=False),
                    now,
                    wid,
                ),
            )
        conn.commit()


def get_entity(name: str) -> dict[str, Any] | None:
    name_clean = (name or "").strip()
    if not name_clean:
        return None
    wid = _ws()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_entities WHERE lower(name) = lower(?) AND workspace_id = ?",
            (name_clean, wid),
        ).fetchone()
    if not row:
        return None
    return _hydrate_entity_row(dict(row))


def search_entities(query: str) -> list[dict[str, Any]]:
    q = (query or "").strip().lower()
    if not q:
        return []
    wid = _ws()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_entities WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50",
            (wid,),
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
    wid = _ws()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_entities WHERE workspace_id = ? ORDER BY entity_type, name",
            (wid,),
        ).fetchall()
    return [_hydrate_entity_row(dict(r)) for r in rows or []]


def build_entity_context_block(
    mission_text: str = "",
    *,
    agent_group_id: str | None = None,
) -> str:
    """Injecte un extrait d'entités pertinentes pour la mission."""
    try:
        uses_enterprise = True
        try:
            from services.agent_groups import group_uses_enterprise_science

            uses_enterprise = bool(group_uses_enterprise_science(agent_group_id))
        except Exception:
            uses_enterprise = True
        query = (mission_text or "").strip()
        entities = search_entities(mission_text) if query else []
        if not uses_enterprise:
            # Équipe projet : uniquement les entités qui matchent la consigne, pas le graphe entier.
            if not entities:
                return ""
        else:
            if not query:
                entities = list_entities()[:8]
            if not entities:
                entities = list_entities()[:6]
        if not entities:
            return ""
        lines = ["--- Connaissance métier (entités workspace) ---"]
        for e in entities[:8]:
            attrs = e.get("attributes") or {}
            summary = ", ".join(f"{k}={v}" for k, v in list(attrs.items())[:4])
            lines.append(f"- {e.get('name')} ({e.get('entity_type')}): {summary}")
        lines.append("--- Fin connaissance ---")
        return "\n".join(lines)
    except Exception:
        logger.exception("build_entity_context_block")
        return ""
