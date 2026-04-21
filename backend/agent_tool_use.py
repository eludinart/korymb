"""
Exécution d'outils dans le flux Korymb v3.1 via tool use Anthropic ou OpenAI-compatible.
Providers de recherche : Tavily (TAVILY_API_KEY) → Brave (BRAVE_SEARCH_API_KEY) → DuckDuckGo.
Lecture de pages : Jina AI Reader (sans clé) → httpx direct.
Nouveaux outils : describe_image (Claude Haiku Vision), read_facebook_posts, read_instagram_media.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

ToolEmitFn = Callable[[str, str, dict[str, Any]], None]

import anthropic
import httpx

from llm_client import (
    _UNSET,
    format_llm_provider_http_error,
    llm_turn,
    log_llm_call_financial,
    openrouter_post_with_retries,
)
from llm_tiers import resolve_openrouter_tier
from runtime_settings import merge_with_env
from tools import (
    run_describe_image,
    run_post_facebook,
    run_post_instagram,
    run_read_facebook_posts,
    run_read_instagram_media,
    run_read_webpage,
    run_search_linkedin,
    run_send_email,
    run_upload_google_drive,
    run_web_search,
)
from tools.agent_tools import get_fleet_status, search_core_notes, validate_syntax
from debug_ndjson import append_session_ndjson

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = max(1, int(os.getenv("KORYMB_MAX_TOOL_ROUNDS", "12")))
_MAX_TOOL_OUTPUT = 18_000


def _parse_tool_arguments(raw: Any) -> dict[str, Any]:
    """OpenAI / OpenRouter : `arguments` peut être une chaîne JSON ou déjà un objet."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return {}
        try:
            o = json.loads(s)
            return o if isinstance(o, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _openrouter_extract_visible_text(msg: dict[str, Any]) -> str:
    """Texte assistant : content string/list + champs reasoning usités par certains modèles."""
    parts: list[str] = []
    for key in ("reasoning", "reasoning_content", "thinking"):
        v = msg.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    c = msg.get("content")
    if isinstance(c, str) and c.strip():
        parts.append(c.strip())
    elif isinstance(c, list):
        for x in c:
            if not isinstance(x, dict):
                continue
            if x.get("type") == "text" and x.get("text"):
                parts.append(str(x["text"]).strip())
            elif x.get("text"):
                parts.append(str(x["text"]).strip())
    return "\n\n".join(parts).strip()


# Clés AGENTS_DEF["tools"] → noms d'outils LLM
_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "web": ("web_search", "read_webpage", "describe_image"),
    "linkedin": ("search_linkedin",),
    "email": ("send_email",),
    "instagram": ("post_instagram", "read_instagram_media"),
    "facebook": ("post_facebook", "read_facebook_posts"),
    "drive": ("upload_google_drive",),
    # Outils augmentés KORYMB v3 (agentic OS)
    "knowledge": ("search_core_notes", "get_fleet_status"),
    "validate": ("validate_syntax",),
}

_ALL_ANTHROPIC_TOOLS: list[dict[str, Any]] = [
    {
        "name": "web_search",
        "description": (
            "Recherche web multi-provider (Tavily → Brave → DuckDuckGo). "
            "Retourne 10 résultats avec titre, URL et extrait. "
            "Utilise pour : prospects, concurrents, actualités, tendances, annuaires, profils publics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Requête en français ou anglais"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_webpage",
        "description": (
            "Lit le texte complet d'une page web (URL http/https). "
            "Utilise Jina AI Reader pour les sites JavaScript modernes (LinkedIn, Insta, etc.). "
            "Retourne jusqu'à 8 000 caractères de contenu propre. "
            "Utilise pour lire un profil LinkedIn, un site vitrine, un article de blog."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL complète (http:// ou https://)"}},
            "required": ["url"],
        },
    },
    {
        "name": "search_linkedin",
        "description": (
            "Recherche profils individuels (linkedin.com/in/) et pages entreprises (linkedin.com/company/) "
            "sur LinkedIn à partir de mots-clés (métier, ville, secteur, nom). "
            "Pour lire le détail d'un profil trouvé : enchaîne avec read_webpage."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Métier, ville, secteur, nom, entreprise…"}},
            "required": ["query"],
        },
    },
    {
        "name": "describe_image",
        "description": (
            "Analyse et décrit le contenu visuel d'une image (URL publique http/https) via Claude Vision. "
            "Retourne une description détaillée : personnes, textes visibles, couleurs, ambiance, "
            "éléments marketing. Utilise pour : analyser un post Instagram, un visuel concurrent, "
            "lire un texte dans une image, comprendre une photo de produit."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "image_url": {"type": "string", "description": "URL publique de l'image (http:// ou https://)"},
                "context": {"type": "string", "description": "Contexte optionnel pour guider l'analyse (ex: 'post Instagram concurrent')"},
            },
            "required": ["image_url"],
        },
    },
    {
        "name": "send_email",
        "description": "Prépare ou envoie un email de prospection ou suivi (sans SMTP configuré : génère le brouillon).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Adresse email du destinataire"},
                "subject": {"type": "string", "description": "Objet du message"},
                "body": {"type": "string", "description": "Corps du message en texte brut"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "post_instagram",
        "description": "Publie un post sur le compte Instagram d'Élude In Art (réel si tokens Meta configurés).",
        "input_schema": {
            "type": "object",
            "properties": {
                "caption": {"type": "string", "description": "Texte du post avec hashtags"},
                "image_url": {"type": "string", "description": "Optionnel — URL publique de l'image"},
            },
            "required": ["caption"],
        },
    },
    {
        "name": "read_instagram_media",
        "description": (
            "Lit les derniers médias publiés sur le compte Instagram d'Élude In Art. "
            "Retourne caption, type, date, lien, URL image. "
            "Utilise pour : auditer la présence Instagram, éviter les doublons, analyser les contenus passés."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Nombre de posts à récupérer (max 20, défaut 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "post_facebook",
        "description": "Publie un post sur la page Facebook d'Élude In Art (réel si tokens Meta configurés).",
        "input_schema": {
            "type": "object",
            "properties": {"message": {"type": "string", "description": "Texte du post"}},
            "required": ["message"],
        },
    },
    {
        "name": "read_facebook_posts",
        "description": (
            "Lit les derniers posts de la page Facebook d'Élude In Art. "
            "Retourne texte, date, lien, image. "
            "Utilise pour : auditer la présence Facebook, analyser l'engagement, éviter les doublons."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Nombre de posts à récupérer (max 25, défaut 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "upload_google_drive",
        "description": "Crée un fichier texte ou markdown sur Google Drive d'Élude In Art.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "Nom du fichier avec extension"},
                "content": {"type": "string", "description": "Contenu textuel du fichier"},
                "mime_type": {"type": "string", "description": "Optionnel, ex. text/plain, text/markdown"},
                "folder_id": {"type": "string", "description": "Optionnel, ID du dossier Drive cible"},
            },
            "required": ["filename", "content"],
        },
    },
    # ── Outils augmentés KORYMB v3 ──────────────────────────────────────────
    {
        "name": "search_core_notes",
        "description": (
            "Recherche dans les notes et documentations internes KORYMB (CORE/*.md, docs/, .cursor/rules/). "
            "Utilise pour trouver des contextes projet, décisions architecturales, règles métier."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Termes de recherche en français ou anglais"},
                "max_results": {"type": "integer", "description": "Nombre max de résultats (défaut: 6)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "validate_syntax",
        "description": (
            "Vérifie la syntaxe d'un bloc de code sans l'exécuter (sandbox sécurisée). "
            "Langages : python, js/javascript, ts/typescript."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Code à vérifier"},
                "language": {"type": "string", "description": "Langage : python | js | ts (défaut: python)"},
            },
            "required": ["code"],
        },
    },
    {
        "name": "get_fleet_status",
        "description": (
            "Retourne les constantes d'actifs de l'Empire Élude In Art : "
            "Sivana (écolieu, contraintes terrain), Ti Spoun (ancrage artisanal), "
            "Éric (dirigeant), Fleur d'ÅmÔurs (tarot, business model). "
            "Utilise en début de mission pour ancrer les propositions dans la réalité terrain."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]


def tool_names_for_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for tag in tags:
        for name in _TAG_TO_TOOLS.get(tag, ()):
            if name not in seen:
                seen.add(name)
                out.append(name)
    return out


def _filter_anthropic_tools(allowed: set[str]) -> list[dict[str, Any]]:
    return [t for t in _ALL_ANTHROPIC_TOOLS if t["name"] in allowed]


def _filter_openai_tools(allowed: set[str]) -> list[dict[str, Any]]:
    out = []
    for t in _ALL_ANTHROPIC_TOOLS:
        if t["name"] not in allowed:
            continue
        out.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t["input_schema"],
            },
        })
    return out


def _execute_tool(name: str, inp: Any) -> str:
    if not isinstance(inp, dict):
        try:
            inp = json.loads(inp) if isinstance(inp, str) else {}
        except json.JSONDecodeError:
            inp = {}
    try:
        if name == "web_search":
            return run_web_search(str(inp.get("query", "")))
        if name == "read_webpage":
            return run_read_webpage(str(inp.get("url", "")))
        if name == "search_linkedin":
            return run_search_linkedin(str(inp.get("query", "")))
        if name == "send_email":
            return run_send_email(
                str(inp.get("to", "")),
                str(inp.get("subject", "")),
                str(inp.get("body", "")),
            )
        if name == "describe_image":
            return run_describe_image(
                str(inp.get("image_url", "")),
                str(inp.get("context", "") or ""),
            )
        if name == "post_instagram":
            return run_post_instagram(
                str(inp.get("caption", "")),
                str(inp.get("image_url", "") or ""),
            )
        if name == "read_instagram_media":
            limit = int(inp.get("limit") or 10)
            return run_read_instagram_media(limit)
        if name == "post_facebook":
            return run_post_facebook(str(inp.get("message", "")))
        if name == "read_facebook_posts":
            limit = int(inp.get("limit") or 10)
            return run_read_facebook_posts(limit)
        if name == "upload_google_drive":
            return run_upload_google_drive(
                str(inp.get("filename", "")),
                str(inp.get("content", "")),
                str(inp.get("mime_type", "") or "text/plain"),
                str(inp.get("folder_id", "") or ""),
            )
        # ── Outils augmentés KORYMB v3 ────────────────────────────────────────
        if name == "search_core_notes":
            max_r = int(inp.get("max_results") or 6)
            return search_core_notes(str(inp.get("query", "")), max_results=max_r)
        if name == "validate_syntax":
            result = validate_syntax(
                str(inp.get("code", "")),
                language=str(inp.get("language", "python")),
            )
            return json.dumps(result, ensure_ascii=False)
        if name == "get_fleet_status":
            return json.dumps(get_fleet_status(), ensure_ascii=False, indent=2)
    except Exception as e:
        return f"Erreur outil {name} : {e}"
    return f"Outil inconnu : {name}"


def _tool_input_preview(raw_in: Any) -> dict[str, Any]:
    if isinstance(raw_in, dict):
        d = dict(raw_in)
    elif hasattr(raw_in, "items"):
        try:
            d = dict(raw_in.items())  # type: ignore[arg-type]
        except Exception:
            d = {"_value": str(raw_in)[:400]}
    else:
        d = {"_value": str(raw_in)[:400]}
    try:
        s = json.dumps(d, ensure_ascii=False)
    except (TypeError, ValueError):
        s = str(d)[:400]
    if len(s) > 400:
        return {"_truncated": True, "preview": s[:400] + "…"}
    return d


def _classify_tool_outcome(name: str, preview: str) -> tuple[bool, str | None]:
    """Heuristique sur le texte renvoyé par run_* (pas d’exception levée)."""
    t = (preview or "").strip()
    if name in ("web_search", "search_linkedin"):
        if t.startswith("Erreur recherche") or t.startswith("DuckDuckGo non disponible"):
            return False, "web_provider"
        return True, None
    if name == "read_webpage":
        if t.startswith("Impossible de lire") or t.startswith("Erreur outil read_webpage"):
            return False, "http_fetch"
        if t.startswith("URL refusée"):
            return False, "bad_url"
        return True, None
    if t.startswith("Erreur outil "):
        return False, "tool_error"
    return True, None


def _log_tool(
    job_logs: list[str] | None,
    name: str,
    preview: str,
    *,
    on_tool: ToolEmitFn | None = None,
    tool_actor: str | None = None,
    tool_input: Any = None,
) -> None:
    if job_logs is not None:
        p = preview.replace("\n", " ")[:220]
        job_logs.append(f"[outil] {name} → {p}")
    if on_tool and tool_actor:
        ok, err_kind = _classify_tool_outcome(name, preview)
        on_tool(
            tool_actor,
            name,
            {
                "tool": name,
                "input": _tool_input_preview(tool_input),
                "output_preview": preview.replace("\n", " ")[:220],
                "ok": ok,
                "error_kind": err_kind,
            },
        )


def _anthropic_extract_text(content: Any) -> str:
    parts: list[str] = []
    for block in content or []:
        t = getattr(block, "type", None) or (block.get("type") if isinstance(block, dict) else None)
        if t == "text":
            tx = getattr(block, "text", None) if not isinstance(block, dict) else block.get("text")
            if tx:
                parts.append(str(tx))
    return "".join(parts).strip()


def llm_turn_maybe_tools(
    system: str,
    user_text: str,
    tool_tags: list[str] | None,
    job_logs: list[str] | None,
    max_tokens: int = 4096,
    on_tool: ToolEmitFn | None = None,
    tool_actor: str | None = None,
    *,
    or_profile: str | None = None,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
    temperature: float | None = None,
) -> tuple[str, int, int]:
    names = tool_names_for_tags(tool_tags or [])
    if not names:
        prof = or_profile or ("standard" if int(max_tokens) >= 3200 else "lite")
        return llm_turn(
            system,
            user_text,
            max_tokens=max_tokens,
            or_profile=prof,
            usage_job_id=usage_job_id,
            usage_context=usage_context,
            temperature=temperature,
        )
    return llm_turn_with_tools(
        system,
        user_text,
        names,
        job_logs,
        max_tokens,
        on_tool=on_tool,
        tool_actor=tool_actor,
        usage_job_id=usage_job_id,
        usage_context=usage_context,
        temperature=temperature,
    )


def llm_turn_with_tools(
    system: str,
    user_text: str,
    tool_names: list[str],
    job_logs: list[str] | None,
    max_tokens: int = 4096,
    on_tool: ToolEmitFn | None = None,
    tool_actor: str | None = None,
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
    temperature: float | None = None,
) -> tuple[str, int, int]:
    allowed = set(tool_names)
    extra = (
        "\n\nTu disposes d'outils puissants : recherche web multi-provider (Tavily/Brave/DuckDuckGo), "
        "lecture de pages avec rendu JS (Jina Reader), recherche LinkedIn publique (profils + entreprises), "
        "analyse d'images via Claude Vision (describe_image), lecture des posts Facebook/Instagram, "
        "brouillon d'email, création de fichier Google Drive. "
        "Appelle SYSTÉMATIQUEMENT les outils pour tout fait, contact ou contenu visuel à l'instant T. "
        "Ne jamais inventer d'URLs — utilise web_search puis read_webpage pour les obtenir."
    )
    system_use = system + extra
    cfg = merge_with_env()
    prov = str(cfg.get("llm_provider") or "anthropic")
    if prov == "openrouter":
        return _openrouter_tool_loop(
            system_use,
            user_text,
            allowed,
            job_logs,
            max_tokens,
            cfg,
            on_tool,
            tool_actor,
            usage_job_id=usage_job_id,
            usage_context=usage_context,
            temperature=temperature,
        )
    return _anthropic_tool_loop(
        system_use,
        user_text,
        allowed,
        job_logs,
        max_tokens,
        cfg,
        on_tool,
        tool_actor,
        usage_job_id=usage_job_id,
        usage_context=usage_context,
        temperature=temperature,
    )


def _anthropic_tool_loop(
    system: str,
    user_text: str,
    allowed: set[str],
    job_logs: list[str] | None,
    max_tokens: int,
    cfg: dict[str, Any],
    on_tool: ToolEmitFn | None = None,
    tool_actor: str | None = None,
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
    temperature: float | None = None,
) -> tuple[str, int, int]:
    from anthropic import Anthropic

    if not str(cfg.get("anthropic_api_key") or "").strip():
        raise RuntimeError("ANTHROPIC_API_KEY manquant")
    client = Anthropic(api_key=str(cfg["anthropic_api_key"]))
    model = str(cfg.get("anthropic_model") or "claude-sonnet-4-6")
    tools = _filter_anthropic_tools(allowed)
    if not tools:
        return llm_turn(
            system,
            user_text,
            max_tokens=max_tokens,
            or_profile="standard",
            usage_job_id=usage_job_id,
            usage_context=usage_context,
            temperature=temperature,
        )

    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_text}]
    t_in = t_out = 0
    last_text = ""
    last_stop = ""
    used_followup = False
    _tool_kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "tools": tools,
    }
    if temperature is not None:
        _tool_kwargs["temperature"] = float(temperature)

    for _ in range(_MAX_TOOL_ROUNDS):
        resp = client.messages.create(**{**_tool_kwargs, "messages": messages})
        ri = int(resp.usage.input_tokens or 0)
        ro = int(resp.usage.output_tokens or 0)
        t_in += ri
        t_out += ro
        log_llm_call_financial(
            provider="anthropic",
            model=model,
            tier="anthropic+tools",
            tokens_in=ri,
            tokens_out=ro,
            price_input_per_million=pin,
            price_output_per_million=pout,
            job_id=usage_job_id,
            context_label=usage_context if usage_context is not _UNSET else "anthropic_tools",
        )
        last_stop = str(getattr(resp, "stop_reason", None) or "")

        if resp.stop_reason != "tool_use":
            last_text = _anthropic_extract_text(resp.content) or last_text
            break

        preface = _anthropic_extract_text(resp.content)
        if preface:
            last_text = preface

        tool_blocks: list[dict[str, Any]] = []
        for block in resp.content:
            bt = getattr(block, "type", None)
            if bt != "tool_use":
                continue
            name = getattr(block, "name", "")
            tid = getattr(block, "id", "")
            raw_in = getattr(block, "input", {}) or {}
            if name not in allowed:
                out = f"Outil {name!r} non autorisé pour ce rôle."
            else:
                out = _execute_tool(name, raw_in)
            out = (out or "")[:_MAX_TOOL_OUTPUT]
            _log_tool(
                job_logs,
                name,
                out,
                on_tool=on_tool,
                tool_actor=tool_actor,
                tool_input=raw_in if isinstance(raw_in, dict) else raw_in,
            )
            tool_blocks.append({"type": "tool_result", "tool_use_id": tid, "content": out})

        messages.append({"role": "assistant", "content": resp.content})
        if tool_blocks:
            messages.append({"role": "user", "content": tool_blocks})
        else:
            last_text = _anthropic_extract_text(resp.content) or last_text
            break

    if not (last_text or "").strip():
        used_followup = True
        messages.append({
            "role": "user",
            "content": (
                "Les messages ci-dessus incluent les résultats d’outils le cas échéant. "
                "Réponds maintenant en **texte uniquement** (sans appel d’outil), en français, "
                "avec une synthèse exploitable pour le CIO : faits, limites, recommandations courtes. "
                "Pour une demande d’**heure civile** : indique l’heure actuelle avec fuseau **Europe/Paris**."
            ),
        })
        resp2 = client.messages.create(
            model=model,
            max_tokens=min(int(max_tokens), 2048),
            system=system,
            messages=messages,
        )
        ri2 = int(resp2.usage.input_tokens or 0)
        ro2 = int(resp2.usage.output_tokens or 0)
        t_in += ri2
        t_out += ro2
        log_llm_call_financial(
            provider="anthropic",
            model=model,
            tier="anthropic+tools_followup",
            tokens_in=ri2,
            tokens_out=ro2,
            price_input_per_million=pin,
            price_output_per_million=pout,
            job_id=usage_job_id,
            context_label=usage_context if usage_context is not _UNSET else "anthropic_tools_followup",
        )
        last_stop = str(getattr(resp2, "stop_reason", None) or last_stop)
        last_text = _anthropic_extract_text(resp2.content) or last_text

    # region agent log
    append_session_ndjson(
        tool_actor or "subagent",
        "H2",
        "agent_tool_use:_anthropic_tool_loop:exit",
        "anthropic_tools_exit",
        {
            "last_text_chars": len(last_text or ""),
            "last_stop": last_stop,
            "used_followup": used_followup,
        },
    )
    # endregion

    return last_text or "(Aucune réponse textuelle.)", t_in, t_out


def _openrouter_tool_loop(
    system: str,
    user_text: str,
    allowed: set[str],
    job_logs: list[str] | None,
    max_tokens: int,
    cfg: dict[str, Any],
    on_tool: ToolEmitFn | None = None,
    tool_actor: str | None = None,
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
    temperature: float | None = None,
) -> tuple[str, int, int]:
    if not str(cfg.get("openrouter_api_key") or "").strip():
        raise RuntimeError("OPENROUTER_API_KEY manquant")
    base = str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['openrouter_api_key']}",
        "Content-Type": "application/json",
    }
    ref = str(cfg.get("openrouter_http_referer") or "").strip()
    if ref:
        headers["HTTP-Referer"] = ref
    title = str(cfg.get("openrouter_app_title") or "").strip()
    if title:
        headers["X-Title"] = title

    otools = _filter_openai_tools(allowed)
    if not otools:
        return llm_turn(
            system,
            user_text,
            max_tokens=max_tokens,
            or_profile="standard",
            usage_job_id=usage_job_id,
            usage_context=usage_context,
            temperature=temperature,
        )

    om: list[dict[str, Any]] = []
    if system.strip():
        om.append({"role": "system", "content": system})
    om.append({"role": "user", "content": user_text})

    model, tier_key, pin, pout = resolve_openrouter_tier(cfg, "heavy")
    t_in = t_out = 0
    last_text = ""

    with httpx.Client(timeout=180.0) as http:
        for round_i in range(_MAX_TOOL_ROUNDS):
            body: dict[str, Any] = {
                "model": model,
                "messages": om,
                "max_tokens": max_tokens,
                "tools": otools,
                "tool_choice": "auto",
            }
            if temperature is not None:
                body["temperature"] = float(temperature)
            r = openrouter_post_with_retries(http, url, headers, body)
            # Modèles gratuits / non-OpenAI (ex. Gemma sur OpenRouter) refusent souvent function calling → 400.
            if r.status_code in (400, 422) and otools and round_i == 0:
                logger.warning(
                    "OpenRouter : outils refusés (%s) pour %s — repli sans outils.",
                    r.status_code,
                    model,
                )
                return llm_turn(
                    system,
                    user_text,
                    max_tokens=max_tokens,
                    or_profile="standard",
                    usage_job_id=usage_job_id,
                    usage_context=usage_context,
                )
            if r.status_code >= 400:
                logger.warning("OpenRouter tools HTTP %s — %s", r.status_code, r.text[:600])
                hint = format_llm_provider_http_error(r)
                raise RuntimeError(
                    f"Le fournisseur LLM a répondu HTTP {r.status_code}. {hint}"
                ) from None
            data = r.json()
            usage = data.get("usage") or {}
            pi = int(usage.get("prompt_tokens") or 0)
            co = int(usage.get("completion_tokens") or 0)
            t_in += pi
            t_out += co
            log_llm_call_financial(
                provider="openrouter",
                model=model,
                tier=tier_key,
                tokens_in=pi,
                tokens_out=co,
                price_input_per_million=pin,
                price_output_per_million=pout,
                job_id=usage_job_id,
                context_label=usage_context if usage_context is not _UNSET else "openrouter_tools",
            )
            choice = (data.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            tcalls_raw = msg.get("tool_calls")
            tcalls = tcalls_raw if isinstance(tcalls_raw, list) else []

            if not tcalls:
                last_text = _openrouter_extract_visible_text(msg)
                break

            om.append({
                "role": "assistant",
                "content": msg.get("content") if msg.get("content") is not None else "",
                "tool_calls": tcalls,
            })
            for tc in tcalls:
                tid = tc.get("id", "")
                fn = (tc.get("function") or {})
                name = fn.get("name", "")
                args = _parse_tool_arguments(fn.get("arguments"))
                if name not in allowed:
                    out = f"Outil {name!r} non autorisé pour ce rôle."
                else:
                    out = _execute_tool(name, args)
                out = (out or "")[:_MAX_TOOL_OUTPUT]
                _log_tool(
                    job_logs,
                    name,
                    out,
                    on_tool=on_tool,
                    tool_actor=tool_actor,
                    tool_input=args,
                )
                om.append({"role": "tool", "tool_call_id": tid, "content": out})

        if not (last_text or "").strip():
            om_follow = list(om)
            om_follow.append({
                "role": "user",
                "content": (
                    "Les messages ci-dessus incluent les résultats d’outils le cas échéant. "
                    "Réponds maintenant en **texte uniquement** (sans appel d’outil), en français, "
                    "avec une synthèse exploitable pour le CIO : faits, sources implicites, limites, "
                    "recommandations courtes. Au moins 4 phrases."
                ),
            })
            body_follow: dict[str, Any] = {
                "model": model,
                "messages": om_follow,
                "max_tokens": min(int(max_tokens), 2048),
            }
            try:
                rf = openrouter_post_with_retries(http, url, headers, body_follow)
                if rf.status_code < 400:
                    d2 = rf.json()
                    u2 = d2.get("usage") or {}
                    pi2 = int(u2.get("prompt_tokens") or 0)
                    co2 = int(u2.get("completion_tokens") or 0)
                    t_in += pi2
                    t_out += co2
                    log_llm_call_financial(
                        provider="openrouter",
                        model=model,
                        tier=f"{tier_key}+followup",
                        tokens_in=pi2,
                        tokens_out=co2,
                        price_input_per_million=pin,
                        price_output_per_million=pout,
                        job_id=usage_job_id,
                        context_label=usage_context if usage_context is not _UNSET else "openrouter_tools_followup",
                    )
                    msg2 = (d2.get("choices") or [{}])[0].get("message") or {}
                    last_text = _openrouter_extract_visible_text(msg2)
                else:
                    logger.warning(
                        "OpenRouter : passe synthèse sans outils HTTP %s — %s",
                        rf.status_code,
                        rf.text[:400],
                    )
            except Exception as e:
                logger.warning("OpenRouter : passe synthèse sans outils échouée — %s", e)

    return last_text or "(Aucune réponse textuelle.)", t_in, t_out


def llm_chat_maybe_tools(
    system: str,
    messages: list[dict],
    tool_tags: list[str] | None,
    job_logs: list[str] | None,
    max_tokens: int = 2048,
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    names = tool_names_for_tags(tool_tags or [])
    if not names:
        from llm_client import llm_chat

        return llm_chat(
            system,
            messages,
            max_tokens=max_tokens,
            or_profile="lite",
            usage_job_id=usage_job_id,
            usage_context=usage_context,
        )
    return llm_chat_with_tools(
        system,
        messages,
        names,
        job_logs,
        max_tokens,
        usage_job_id=usage_job_id,
        usage_context=usage_context,
    )


def llm_chat_with_tools(
    system: str,
    messages: list[dict],
    tool_names: list[str],
    job_logs: list[str] | None,
    max_tokens: int = 2048,
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    allowed = set(tool_names)
    extra = (
        "\n\nOutils disponibles : recherche web multi-provider, lecture de page (Jina Reader), "
        "recherche LinkedIn, analyse d'images (describe_image), lecture posts Facebook/Instagram, "
        "brouillon email, création fichier Drive. "
        "Utilise-les si la question exige des données à jour, des sources ou des visuels."
    )
    system_use = system + extra
    cfg = merge_with_env()
    prov = str(cfg.get("llm_provider") or "anthropic")
    if prov == "openrouter":
        return _openrouter_chat_tool_loop(
            system_use,
            messages,
            allowed,
            job_logs,
            max_tokens,
            cfg,
            usage_job_id=usage_job_id,
            usage_context=usage_context,
        )
    return _anthropic_chat_tool_loop(
        system_use,
        messages,
        allowed,
        job_logs,
        max_tokens,
        cfg,
        usage_job_id=usage_job_id,
        usage_context=usage_context,
    )


def _anthropic_chat_tool_loop(
    system: str,
    messages: list[dict],
    allowed: set[str],
    job_logs: list[str] | None,
    max_tokens: int,
    cfg: dict[str, Any],
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    from anthropic import Anthropic

    if not str(cfg.get("anthropic_api_key") or "").strip():
        raise RuntimeError("ANTHROPIC_API_KEY manquant")
    client = Anthropic(api_key=str(cfg["anthropic_api_key"]))
    model = str(cfg.get("anthropic_model") or "claude-sonnet-4-6")
    tools = _filter_anthropic_tools(allowed)
    if not tools:
        from llm_client import llm_chat

        return llm_chat(system, messages, max_tokens=max_tokens, or_profile="standard")

    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    amsg: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str):
            amsg.append({"role": m["role"], "content": c})

    t_in = t_out = 0
    last_text = ""
    last_stop = ""

    for _ in range(_MAX_TOOL_ROUNDS):
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=amsg,
            tools=tools,
        )
        ri = int(resp.usage.input_tokens or 0)
        ro = int(resp.usage.output_tokens or 0)
        t_in += ri
        t_out += ro
        log_llm_call_financial(
            provider="anthropic",
            model=model,
            tier="anthropic_chat+tools",
            tokens_in=ri,
            tokens_out=ro,
            price_input_per_million=pin,
            price_output_per_million=pout,
            job_id=usage_job_id,
            context_label=usage_context if usage_context is not _UNSET else "anthropic_chat_tools",
        )
        last_stop = str(getattr(resp, "stop_reason", None) or "")

        if resp.stop_reason != "tool_use":
            last_text = _anthropic_extract_text(resp.content) or last_text
            break

        preface = _anthropic_extract_text(resp.content)
        if preface:
            last_text = preface

        tool_blocks: list[dict[str, Any]] = []
        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            name = getattr(block, "name", "")
            tid = getattr(block, "id", "")
            raw_in = getattr(block, "input", {}) or {}
            out = _execute_tool(name, raw_in) if name in allowed else f"Outil {name!r} non autorisé."
            out = (out or "")[:_MAX_TOOL_OUTPUT]
            _log_tool(job_logs, name, out)
            tool_blocks.append({"type": "tool_result", "tool_use_id": tid, "content": out})

        amsg.append({"role": "assistant", "content": resp.content})
        if tool_blocks:
            amsg.append({"role": "user", "content": tool_blocks})
        else:
            last_text = _anthropic_extract_text(resp.content) or last_text
            break

    if not (last_text or "").strip():
        amsg.append({
            "role": "user",
            "content": (
                "Les messages ci-dessus incluent les résultats d’outils le cas échéant. "
                "Réponds maintenant en **texte uniquement** (sans appel d’outil), en français, "
                "avec une synthèse exploitable. "
                "Pour une demande d’**heure civile** : indique l’heure actuelle avec fuseau **Europe/Paris**."
            ),
        })
        resp2 = client.messages.create(
            model=model,
            max_tokens=min(int(max_tokens), 2048),
            system=system,
            messages=amsg,
        )
        ri2 = int(resp2.usage.input_tokens or 0)
        ro2 = int(resp2.usage.output_tokens or 0)
        t_in += ri2
        t_out += ro2
        log_llm_call_financial(
            provider="anthropic",
            model=model,
            tier="anthropic_chat+tools_followup",
            tokens_in=ri2,
            tokens_out=ro2,
            price_input_per_million=pin,
            price_output_per_million=pout,
            job_id=usage_job_id,
            context_label=usage_context if usage_context is not _UNSET else "anthropic_chat_tools_followup",
        )
        last_stop = str(getattr(resp2, "stop_reason", None) or last_stop)
        last_text = _anthropic_extract_text(resp2.content) or last_text

    return last_text or "(Aucune réponse textuelle.)", t_in, t_out


def _openrouter_chat_tool_loop(
    system: str,
    messages: list[dict],
    allowed: set[str],
    job_logs: list[str] | None,
    max_tokens: int,
    cfg: dict[str, Any],
    *,
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    if not str(cfg.get("openrouter_api_key") or "").strip():
        raise RuntimeError("OPENROUTER_API_KEY manquant")
    base = str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['openrouter_api_key']}",
        "Content-Type": "application/json",
    }
    ref = str(cfg.get("openrouter_http_referer") or "").strip()
    if ref:
        headers["HTTP-Referer"] = ref
    title = str(cfg.get("openrouter_app_title") or "").strip()
    if title:
        headers["X-Title"] = title

    otools = _filter_openai_tools(allowed)
    if not otools:
        from llm_client import llm_chat

        return llm_chat(system, messages, max_tokens=max_tokens, or_profile="standard")

    om: list[dict[str, Any]] = []
    if system.strip():
        om.append({"role": "system", "content": system})
    for m in messages:
        if m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str):
            om.append({"role": m["role"], "content": c})

    model, tier_key, pin, pout = resolve_openrouter_tier(cfg, "heavy")
    t_in = t_out = 0
    last_text = ""

    with httpx.Client(timeout=180.0) as http:
        for round_i in range(_MAX_TOOL_ROUNDS):
            body = {
                "model": model,
                "messages": om,
                "max_tokens": max_tokens,
                "tools": otools,
                "tool_choice": "auto",
            }
            r = openrouter_post_with_retries(http, url, headers, body)
            if r.status_code in (400, 422) and otools and round_i == 0:
                logger.warning(
                    "OpenRouter : chat+outils refusés (%s) pour %s — repli sans outils.",
                    r.status_code,
                    model,
                )
                from llm_client import llm_chat

                return llm_chat(system, messages, max_tokens=max_tokens, or_profile="standard")
            if r.status_code >= 400:
                logger.warning("OpenRouter chat+tools HTTP %s — %s", r.status_code, r.text[:600])
                hint = format_llm_provider_http_error(r)
                raise RuntimeError(
                    f"Le fournisseur LLM a répondu HTTP {r.status_code}. {hint}"
                ) from None
            data = r.json()
            usage = data.get("usage") or {}
            pi = int(usage.get("prompt_tokens") or 0)
            co = int(usage.get("completion_tokens") or 0)
            t_in += pi
            t_out += co
            log_llm_call_financial(
                provider="openrouter",
                model=model,
                tier=tier_key,
                tokens_in=pi,
                tokens_out=co,
                price_input_per_million=pin,
                price_output_per_million=pout,
                job_id=usage_job_id,
                context_label=usage_context if usage_context is not _UNSET else "openrouter_chat_tools",
            )
            msg = (data.get("choices") or [{}])[0].get("message") or {}
            tcalls_raw = msg.get("tool_calls")
            tcalls = tcalls_raw if isinstance(tcalls_raw, list) else []

            if not tcalls:
                last_text = _openrouter_extract_visible_text(msg)
                break

            om.append({
                "role": "assistant",
                "content": msg.get("content") if msg.get("content") is not None else "",
                "tool_calls": tcalls,
            })
            for tc in tcalls:
                tid = tc.get("id", "")
                fn = tc.get("function") or {}
                name = fn.get("name", "")
                args = _parse_tool_arguments(fn.get("arguments"))
                out = _execute_tool(name, args) if name in allowed else f"Outil {name!r} non autorisé."
                out = (out or "")[:_MAX_TOOL_OUTPUT]
                _log_tool(job_logs, name, out)
                om.append({"role": "tool", "tool_call_id": tid, "content": out})

        if not (last_text or "").strip():
            om_follow = list(om)
            om_follow.append({
                "role": "user",
                "content": (
                    "Réponds en **texte uniquement** (sans outil), en français, synthèse utile pour la suite "
                    "de la conversation, au moins 3 phrases."
                ),
            })
            body_follow = {
                "model": model,
                "messages": om_follow,
                "max_tokens": min(int(max_tokens), 2048),
            }
            try:
                rf = openrouter_post_with_retries(http, url, headers, body_follow)
                if rf.status_code < 400:
                    d2 = rf.json()
                    u2 = d2.get("usage") or {}
                    pi2 = int(u2.get("prompt_tokens") or 0)
                    co2 = int(u2.get("completion_tokens") or 0)
                    t_in += pi2
                    t_out += co2
                    log_llm_call_financial(
                        provider="openrouter",
                        model=model,
                        tier=f"{tier_key}+chat_followup",
                        tokens_in=pi2,
                        tokens_out=co2,
                        price_input_per_million=pin,
                        price_output_per_million=pout,
                        job_id=usage_job_id,
                        context_label=usage_context if usage_context is not _UNSET else "openrouter_chat_tools_followup",
                    )
                    msg2 = (d2.get("choices") or [{}])[0].get("message") or {}
                    last_text = _openrouter_extract_visible_text(msg2)
            except Exception as e:
                logger.warning("OpenRouter chat : passe synthèse sans outils échouée — %s", e)

    return last_text or "(Aucune réponse textuelle.)", t_in, t_out
