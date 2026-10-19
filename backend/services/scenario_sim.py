"""Simulation de scénarios multi-horizons (1 / 5 / 10 ans) — Mode Cerveau P4."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_HORIZONS = ("1_an", "5_ans", "10_ans")
_HORIZON_LABELS = {"1_an": "1 an", "5_ans": "5 ans", "10_ans": "10 ans"}


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _heuristic_scenarios(question: str) -> dict[str, Any]:
    q = (question or "").strip()[:200]
    base = q or "cette décision"
    return {
        "question": q,
        "summary": f"Esquisse heuristique autour de « {base} » (sans LLM).",
        "horizons": [
            {
                "id": "1_an",
                "label": "1 an",
                "narrative": (
                    f"À 1 an, les effets de « {base} » sont surtout opérationnels : "
                    "routines, cashflow court terme, premiers retours clients."
                ),
                "opportunities": ["Apprendre vite", "Corriger le tir"],
                "risks": ["Sous-estimer la charge", "Dispersion"],
                "probability_hint": "plausible",
            },
            {
                "id": "5_ans",
                "label": "5 ans",
                "narrative": (
                    f"À 5 ans, « {base} » a soit composé un avantage différenciant, "
                    "soit été abandonné — selon la constance et le marché."
                ),
                "opportunities": ["Positionnement clair", "Équipe rodée"],
                "risks": ["Obsolescence", "Dépendance à un canal"],
                "probability_hint": "incertain",
            },
            {
                "id": "10_ans",
                "label": "10 ans",
                "narrative": (
                    f"À 10 ans, l’empreinte de « {base} » se lit dans la réputation, "
                    "les actifs cumulés et ce que vous aurez refusé en chemin."
                ),
                "opportunities": ["Patrimoine / corpus", "Liberté de choix"],
                "risks": ["Verrouillage path-dependent", "Fatigue"],
                "probability_hint": "spéculatif",
            },
        ],
        "source": "heuristic",
    }


def _normalize_horizon(raw: Any, *, default_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    hid = str(raw.get("id") or default_id).strip()
    if hid not in _HORIZONS:
        hid = default_id
    opps = raw.get("opportunities") if isinstance(raw.get("opportunities"), list) else []
    risks = raw.get("risks") if isinstance(raw.get("risks"), list) else []
    return {
        "id": hid,
        "label": _HORIZON_LABELS.get(hid, hid),
        "narrative": str(raw.get("narrative") or raw.get("story") or "").strip()[:900],
        "opportunities": [str(x).strip() for x in opps if str(x or "").strip()][:4],
        "risks": [str(x).strip() for x in risks if str(x or "").strip()][:4],
        "probability_hint": str(raw.get("probability_hint") or raw.get("confidence") or "plausible")[:32],
    }


def simulate_decision_scenarios(
    question: str,
    *,
    context: str = "",
    thinking_mode: str = "auto",
) -> dict[str, Any]:
    """
    Produit 3 récits plausibles (1 / 5 / 10 ans) pour une décision / intention.
    Fallback heuristique si le LLM est indisponible.
    """
    q = re.sub(r"\s+", " ", (question or "").strip())[:500]
    if len(q) < 8:
        raise ValueError("Posez une question d'au moins 8 caractères.")

    ctx = (context or "").strip()[:2500]
    mode = str(thinking_mode or "auto").strip().lower()

    mode_hint = ""
    try:
        from services.thinking_modes import thinking_mode_prompt_block

        mode_hint = thinking_mode_prompt_block(mode)
    except Exception:
        mode_hint = ""

    prompt = (
        "Tu es un conseiller stratégique sobre. Simule 3 futurs plausibles "
        "pour la décision / intention suivante.\n"
        f"Intention : {q}\n"
        f"{('Contexte : ' + ctx + chr(10)) if ctx else ''}"
        f"{(mode_hint + chr(10)) if mode_hint else ''}"
        "Réponds UNIQUEMENT en JSON :\n"
        '{"summary":"...","horizons":['
        '{"id":"1_an","narrative":"...","opportunities":["..."],"risks":["..."],"probability_hint":"plausible"},'
        '{"id":"5_ans","narrative":"...","opportunities":["..."],"risks":["..."],"probability_hint":"incertain"},'
        '{"id":"10_ans","narrative":"...","opportunities":["..."],"risks":["..."],"probability_hint":"spéculatif"}'
        "]}\n"
        "Narratifs en français, max 4 phrases chacun. Pas de conseil magique ni de chiffres inventés précis."
    )

    try:
        from llm_client import llm_turn

        text, _, _ = llm_turn(
            prompt,
            max_tokens=1200,
            or_profile="lite",
            usage_context="scenario_sim:p4",
        )
        data = _extract_json(text or "")
        if not data:
            raise RuntimeError("json_parse")
        raw_horizons = data.get("horizons") if isinstance(data.get("horizons"), list) else []
        by_id = {}
        for i, h in enumerate(raw_horizons):
            default = _HORIZONS[i] if i < len(_HORIZONS) else "1_an"
            norm = _normalize_horizon(h, default_id=default)
            if norm["narrative"]:
                by_id[norm["id"]] = norm
        horizons = [by_id.get(hid) or _heuristic_scenarios(q)["horizons"][i] for i, hid in enumerate(_HORIZONS)]
        return {
            "question": q,
            "summary": str(data.get("summary") or "").strip()[:400]
            or f"Trois horizons pour « {q[:80]} ».",
            "horizons": horizons,
            "source": "llm",
            "thinking_mode": mode,
        }
    except Exception:
        logger.exception("scenario simulation LLM failed — heuristic fallback")
        out = _heuristic_scenarios(q)
        out["thinking_mode"] = mode
        return out
