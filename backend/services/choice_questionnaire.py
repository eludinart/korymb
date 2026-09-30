"""Normalisation des questionnaires à choix (QCM) pour chat / CIO / Décisions."""
from __future__ import annotations

import re
from typing import Any


def _slug(label: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")[:40]
    return s or fallback


def normalize_choice_option(raw: Any, index: int) -> dict[str, str] | None:
    if isinstance(raw, str):
        label = raw.strip()
        if not label:
            return None
        return {"id": _slug(label, f"opt-{index + 1}"), "label": label}
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label") or raw.get("text") or raw.get("title") or raw.get("value") or "").strip()
    if not label:
        return None
    oid = str(raw.get("id") or raw.get("key") or _slug(label, f"opt-{index + 1}")).strip()
    return {"id": oid or f"opt-{index + 1}", "label": label}


def normalize_clarifying_question(raw: Any, index: int = 0) -> dict[str, Any] | None:
    """Accepte une string ou {prompt, options, selection}."""
    if isinstance(raw, str):
        prompt = raw.strip()
        if not prompt:
            return None
        return {"id": _slug(prompt, f"q-{index + 1}"), "prompt": prompt, "selection": "text", "options": []}
    if not isinstance(raw, dict):
        return None
    prompt = str(raw.get("prompt") or raw.get("question") or raw.get("title") or raw.get("label") or "").strip()
    if not prompt:
        return None
    raw_opts = raw.get("options") if isinstance(raw.get("options"), list) else raw.get("choices")
    options: list[dict[str, str]] = []
    if isinstance(raw_opts, list):
        for i, opt in enumerate(raw_opts):
            n = normalize_choice_option(opt, i)
            if n:
                options.append(n)
    sel = str(raw.get("selection") or raw.get("mode") or raw.get("type") or "").lower()
    if options:
        selection = "single" if sel in {"single", "radio", "one"} else "multi"
    else:
        selection = "text"
    qid = str(raw.get("id") or raw.get("key") or _slug(prompt, f"q-{index + 1}")).strip()
    return {
        "id": qid or f"q-{index + 1}",
        "prompt": prompt,
        "selection": selection,
        "options": options,
    }


def normalize_clarifying_questions(raw: Any, *, limit: int = 4) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw):
        n = normalize_clarifying_question(item, i)
        if n:
            out.append(n)
        if len(out) >= limit:
            break
    return out


def clarifying_payload_for_event(items: list[dict[str, Any]]) -> dict[str, Any]:
    """questions = libellés (compat) ; question_specs = options pour l’UI."""
    prompts = [str(i.get("prompt") or "").strip() for i in items if str(i.get("prompt") or "").strip()]
    specs: dict[str, Any] = {}
    for i in items:
        prompt = str(i.get("prompt") or "").strip()
        opts = i.get("options") if isinstance(i.get("options"), list) else []
        if prompt and opts:
            specs[prompt] = {
                "selection": i.get("selection") if i.get("selection") in {"single", "multi"} else "multi",
                "options": opts,
            }
    return {"questions": prompts, "question_specs": specs}


# Bloc à coller dans les system prompts (Assistant / CIO).
QCM_INSTRUCTION = (
    "### Questionnaires à cocher (QCM)\n"
    "Quand tu proposes des améliorations, des choix de config, ou que tu as besoin d'arbitrages "
    "clairs (plusieurs options), **n'écris pas seulement une liste ouverte** : "
    "ajoute un bloc JSON dans une fence `korymb-qcm` pour que le dirigeant coche et valide dans l'UI.\n"
    "Exemple :\n"
    "```korymb-qcm\n"
    "{\n"
    '  \"title\": \"Configurer la suite\",\n'
    '  \"questions\": [\n'
    "    {\n"
    '      \"id\": \"canaux\",\n'
    '      \"prompt\": \"Quels canaux prioriser ?\",\n'
    '      \"selection\": \"multi\",\n'
    '      \"options\": [\n'
    '        {\"id\": \"li\", \"label\": \"LinkedIn\"},\n'
    '        {\"id\": \"mail\", \"label\": \"E-mail\"},\n'
    '        {\"id\": \"ig\", \"label\": \"Instagram\"}\n'
    "      ]\n"
    "    }\n"
    "  ],\n"
    '  \"comment_label\": \"Commentaire (optionnel)\"\n'
    "}\n"
    "```\n"
    "`selection`: `multi` (cases) ou `single` (un seul choix). "
    "Pour une question multi facultative (ex. « Autres actions »), mets `\"required\": false`. "
    "Le dirigeant peut toujours ajouter un commentaire libre avant Valider.\n"
    "En plan mission JSON, tu peux aussi mettre des objets dans `clarifying_questions` "
    "avec `prompt` + `options` (+ `selection`) au lieu de simples strings.\n"
)
