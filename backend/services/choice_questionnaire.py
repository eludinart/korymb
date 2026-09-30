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


# Bloc à coller dans les system prompts (Assistant / CIO) — uniquement si demandé.
QCM_INSTRUCTION = (
    "### Questionnaires à cocher (QCM) — demandé explicitement\n"
    "Le dirigeant a demandé un **vrai QCM interactif**. Tu DOIS répondre avec :\n"
    "1) 1–3 phrases d'intro utiles\n"
    "2) **obligatoirement** un bloc fence `korymb-qcm` (pas une liste markdown "
    "« Questions pour la suite », pas de clarifying_questions JSON CIO).\n"
    "Chaque question DOIT avoir des `options` concrètes (au moins 2). "
    "`selection`: `multi` si « coche toutes », `single` si « 1 seul choix ».\n"
    "Exemple exact :\n"
    "```korymb-qcm\n"
    "{\n"
    '  \"title\": \"Nettoyage Korymb\",\n'
    '  \"questions\": [\n'
    "    {\n"
    '      \"id\": \"supprimer\",\n'
    '      \"prompt\": \"Que supprimer définitivement ?\",\n'
    '      \"selection\": \"multi\",\n'
    '      \"options\": [\n'
    '        {\"id\": \"logs\", \"label\": \"Anciens logs / jobs fantômes\"},\n'
    '        {\"id\": \"drafts\", \"label\": \"Brouillons inutiles\"},\n'
    '        {\"id\": \"dup\", \"label\": \"Doublons CRM\"}\n'
    "      ]\n"
    "    },\n"
    "    {\n"
    '      \"id\": \"prio\",\n'
    '      \"prompt\": \"Priorité absolue ?\",\n'
    '      \"selection\": \"single\",\n'
    '      \"options\": [\n'
    '        {\"id\": \"p1\", \"label\": \"Studio Nord\"},\n'
    '        {\"id\": \"p2\", \"label\": \"Ateliers Sïvåñà\"},\n'
    '        {\"id\": \"p3\", \"label\": \"Inbox / Décisions\"}\n'
    "      ]\n"
    "    }\n"
    "  ],\n"
    '  \"comment_label\": \"Commentaire (optionnel)\"\n'
    "}\n"
    "```\n"
    "Interdit : section markdown « Questions pour la suite » à la place du fence.\n"
)

# Comportement par défaut en chat : répondre, ne pas interroger.
QCM_INSTRUCTION_DEFAULT = (
    "### Questionnaires — règle chat\n"
    "N'émets **pas** de bloc `korymb-qcm`, ni de section « Questions pour la suite », "
    "ni de JSON avec `clarifying_questions` / `questions` stratégiques.\n"
    "Réponds d'abord avec des recommandations **concrètes et actionnables** "
    "(listes à puces, prochaines étapes). "
    "Une seule question de clarification max, et seulement si tu es vraiment bloqué "
    "(sinon choisis une hypothèse raisonnable et avance).\n"
    "Si le dirigeant dit « et alors », « go », « réponds », « sans questions », "
    "« arrête de me questionner » : **conclue** sans nouveau questionnaire.\n"
)


_QCM_FENCE_RE = re.compile(r"(?ms)```korymb-qcm\s*\n.*?```")
_QUESTIONS_BLOCK_RE = re.compile(
    r"(?ms)^(?:#{1,3}\s*)?Questions\s+pour\s+la\s+suite\s*\n((?:\s*\d+\.\s+.+\n?)+)",
    re.IGNORECASE,
)
_NUMBERED_LINE_RE = re.compile(r"^\s*\d+\.\s+(.+)$", re.MULTILINE)


def _infer_selection(prompt: str) -> str:
    p = (prompt or "").lower()
    if re.search(r"1\s*seul|un\s*seul|priorit[eé]\s+absolue|radio", p):
        return "single"
    if re.search(r"coche|toutes|multi|plusieurs", p):
        return "multi"
    return "multi"


def _default_options(selection: str) -> list[dict[str, str]]:
    if selection == "single":
        return [
            {"id": "opt-a", "label": "Option A — à préciser dans le commentaire"},
            {"id": "opt-b", "label": "Option B — à préciser dans le commentaire"},
            {"id": "opt-c", "label": "Autre (commentaire)"},
        ]
    return [
        {"id": "yes", "label": "Oui, traiter"},
        {"id": "later", "label": "Plus tard"},
        {"id": "no", "label": "Non / ignorer"},
    ]


def _extract_numbered_prompts(text: str) -> list[str]:
    m = _QUESTIONS_BLOCK_RE.search(text or "")
    blob = m.group(1) if m else (text or "")
    prompts = [g.strip() for g in _NUMBERED_LINE_RE.findall(blob) if g.strip()]
    return prompts[:8]


def ensure_interactive_qcm(text: str, *, title: str = "Questionnaire") -> str:
    """
    Si le modèle a renvoyé une liste « Questions pour la suite » sans fence korymb-qcm,
    convertit en vrai QCM interactif pour l'UI.
    """
    raw = (text or "").strip()
    if not raw:
        return raw
    if _QCM_FENCE_RE.search(raw):
        return raw

    prompts = _extract_numbered_prompts(raw)
    # JSON CIO avec clarifying_questions
    if not prompts:
        try:
            import json

            blob = raw
            if blob.startswith("```"):
                blob = re.sub(r"^```(?:json)?\s*", "", blob, flags=re.I)
                blob = re.sub(r"\s*```\s*$", "", blob)
            data = json.loads(blob)
            if isinstance(data, dict):
                cq = data.get("clarifying_questions") or data.get("questions")
                if isinstance(cq, list):
                    for item in cq:
                        if isinstance(item, str) and item.strip():
                            prompts.append(item.strip())
                        elif isinstance(item, dict):
                            p = str(item.get("prompt") or item.get("question") or "").strip()
                            if p:
                                prompts.append(p)
        except Exception:
            pass
    prompts = [p for p in prompts if p][:8]
    if not prompts:
        return raw

    questions: list[dict[str, Any]] = []
    for i, prompt in enumerate(prompts):
        selection = _infer_selection(prompt)
        questions.append(
            {
                "id": _slug(prompt, f"q-{i + 1}"),
                "prompt": prompt,
                "selection": selection,
                "options": _default_options(selection),
            }
        )
    import json

    payload = {
        "title": title,
        "questions": questions,
        "comment_label": "Commentaire (optionnel)",
    }
    fence = "```korymb-qcm\n" + json.dumps(payload, ensure_ascii=False, indent=2) + "\n```"
    # Retire le bloc questions markdown pour éviter le double affichage.
    intro = _QUESTIONS_BLOCK_RE.sub("", raw).strip()
    intro = re.sub(r"\n{3,}", "\n\n", intro).strip()
    if intro and len(intro) > 8:
        return f"{intro}\n\n{fence}"
    return fence
