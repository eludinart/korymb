"""Recommandations de configuration / propositions chat (apply allowlist)."""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Clés comportements applicables depuis Décisions (jamais LLM / secrets / engine).
APPLYABLE_BEHAVIOR_KEYS: frozenset[str] = frozenset(
    {
        "orchestration.tools.sandbox_execute",
        "learning.auto_apply_mode",
        "orchestration.strict_lazy_delegation",
        "quality.subagent_gate_enabled",
    }
)

CHAT_WRITE_TOOLS: frozenset[str] = frozenset(
    {
        "gestion_upsert_contact",
        "gestion_update_contact",
        "gestion_create_project",
        "gestion_create_quote",
        "gestion_schedule_event",
        "gestion_log_interaction",
    }
)

_INTEGRATION_TOOL_MAP: dict[str, str] = {
    "web_search": "integration:web_search",
    "read_webpage": "integration:read_webpage",
    "instagram": "integration:instagram",
    "facebook": "integration:facebook",
    "google_drive": "integration:google_drive",
    "smtp_email": "integration:smtp",
    "generate_image": "integration:image_gen",
    "generate_video": "integration:video_gen",
    "text_to_speech": "integration:tts",
    "post_linkedin": "integration:linkedin_publish",
    "send_newsletter": "integration:smtp",
}


def _upsert_pending(
    *,
    kind: str,
    target_key: str,
    title: str,
    body: str,
    payload: dict | None = None,
) -> dict | None:
    from database import find_pending_config_suggestion, insert_config_suggestion

    if find_pending_config_suggestion(kind=kind, target_key=target_key):
        return None
    return insert_config_suggestion(
        kind=kind,
        target_key=target_key,
        title=title,
        body=body,
        payload=payload or {},
    )


def scan_config_suggestions(*, job_id: str | None = None) -> list[dict]:
    """
    Analyse santé outils et missions récentes ; crée des suggestions pending dédupliquées.
    N'écrit jamais directement dans integration_settings ni runtime_settings.
    """
    created: list[dict] = []

    try:
        from tools_health import probe_tools_health

        probe = probe_tools_health(force=False)
        for tool_name, row in (probe or {}).items():
            if tool_name in {"cached", "cache_age_s", "checked_at"}:
                continue
            if not isinstance(row, dict):
                continue
            if row.get("ok") is not False:
                continue
            target = _INTEGRATION_TOOL_MAP.get(tool_name, f"tool:{tool_name}")
            detail = str(row.get("detail") or row.get("error") or "sonde en échec")[:500]
            sug = _upsert_pending(
                kind="integration",
                target_key=target,
                title=f"Intégration à vérifier — {tool_name}",
                body=(
                    f"L'outil `{tool_name}` est signalé en panne ou sans clé. "
                    f"Détail : {detail}. "
                    "Vérifiez Administration → Intégrations & clés (aucune modification automatique)."
                ),
                payload={"tool": tool_name, "probe": row},
            )
            if sug:
                created.append(sug)
    except Exception:
        logger.exception("scan_config_suggestions tools probe")

    try:
        from database import count_recent_jobs_with_status_prefix

        err_count = count_recent_jobs_with_status_prefix("error", limit=30)
        if err_count >= 3:
            sug = _upsert_pending(
                kind="orchestration",
                target_key="recent_errors",
                title="Pics d'erreurs mission récentes",
                body=(
                    f"{err_count} missions récentes se terminent en erreur. "
                    "Consultez l'historique et les comportements moteur ; "
                    "aucun réglage n'est modifié automatiquement."
                ),
                payload={"error_count": err_count},
            )
            if sug:
                created.append(sug)
    except Exception:
        logger.exception("scan_config_suggestions error count")

    if job_id:
        try:
            from database import get_job

            row = get_job(job_id)
            if row:
                ti = int(row.get("tokens_in") or 0)
                to = int(row.get("tokens_out") or 0)
                total = ti + to
                if total >= 120_000:
                    sug = _upsert_pending(
                        kind="budget",
                        target_key=f"job:{job_id}",
                        title="Mission à coût tokens élevé",
                        body=(
                            f"La mission {job_id} a consommé environ {total:,} tokens. "
                            "Envisagez un ajustement des comportements ou du profil LLM "
                            "(Administration → Budget / Comportements)."
                        ),
                        payload={"job_id": job_id, "tokens_in": ti, "tokens_out": to},
                    )
                    if sug:
                        created.append(sug)
        except Exception:
            logger.exception("scan_config_suggestions job %s", job_id)

    if created:
        try:
            from services.director_platform import emit_director_notification

            emit_director_notification(
                kind="config_suggestion",
                title="Recommandations système",
                body=f"{len(created)} nouvelle(s) recommandation(s) de configuration.",
                job_id=job_id,
                action_url="/administration/recommandations",
            )
        except Exception:
            logger.exception("Director notification for config suggestions")

    return created


def list_pending_config_suggestions(limit: int = 40) -> list[dict[str, Any]]:
    from database import list_config_suggestions

    return [enrich_config_suggestion(s) for s in list_config_suggestions(status="pending", limit=limit)]


def _behavior_key_from_target(target_key: str) -> str:
    raw = (target_key or "").strip()
    if raw.startswith("behavior:"):
        return raw[len("behavior:") :].strip()
    return raw


def is_applyable(suggestion: dict[str, Any] | None) -> bool:
    if not suggestion:
        return False
    kind = str(suggestion.get("kind") or "").strip()
    if kind in {"crm_write", "platform_spec"}:
        return True
    if kind == "behavior":
        return _behavior_key_from_target(str(suggestion.get("target_key") or "")) in APPLYABLE_BEHAVIOR_KEYS
    return False


def enrich_config_suggestion(suggestion: dict[str, Any] | None) -> dict[str, Any]:
    if not suggestion:
        return {}
    out = dict(suggestion)
    out["applyable"] = is_applyable(out)
    return out


def enqueue_chat_write_proposal(
    *,
    tool_name: str,
    payload: dict[str, Any],
    job_id: str = "",
    agent_key: str = "",
) -> dict[str, Any]:
    from database import insert_config_suggestion

    name = (tool_name or "").strip()
    title_hint = str(payload.get("name") or payload.get("title") or name)[:80]
    sug = insert_config_suggestion(
        kind="crm_write",
        target_key=f"tool:{name}",
        title=f"CRM chat — {title_hint or name}",
        body=(
            f"Le chat propose d'exécuter `{name}` "
            f"(agent `{agent_key or '—'}`, job `{job_id or '—'}`). "
            "Validez dans Décisions pour écrire réellement dans Gestion."
        ),
        payload={
            "tool": name,
            "input": payload,
            "job_id": (job_id or "")[:64],
            "agent_key": (agent_key or "")[:64],
        },
    )
    try:
        from services.director_platform import emit_director_notification

        emit_director_notification(
            kind="config_suggestion",
            title="Proposition CRM (chat)",
            body=str(sug.get("title") or name)[:180],
            job_id=job_id or None,
            action_url="/inbox",
        )
    except Exception:
        logger.exception("notify crm write proposal")
    return sug


def enqueue_platform_change(
    *,
    title: str,
    spec: str,
    intent: str = "",
    files: str = "",
    risk: str = "",
    change_kind: str = "spec",
    behavior_key: str = "",
    behavior_value: Any = None,
    job_id: str = "",
    agent_key: str = "",
) -> dict[str, Any]:
    from database import insert_config_suggestion

    kind_raw = (change_kind or "spec").strip().lower()
    bkey = (behavior_key or "").strip()
    if kind_raw == "behavior" and bkey in APPLYABLE_BEHAVIOR_KEYS:
        kind = "behavior"
        target = f"behavior:{bkey}"
        payload: dict[str, Any] = {
            "behavior_key": bkey,
            "value": behavior_value,
            "job_id": (job_id or "")[:64],
            "agent_key": (agent_key or "")[:64],
            "spec": (spec or "")[:8000],
        }
        body = (
            f"Proposition de réglage `{bkey}` = {behavior_value!r}. "
            f"{(intent or spec or '')[:600]}"
        )
    else:
        kind = "platform_spec"
        target = "platform:spec"
        payload = {
            "intent": (intent or "")[:2000],
            "files": (files or "")[:2000],
            "spec": (spec or "")[:8000],
            "risk": (risk or "")[:800],
            "job_id": (job_id or "")[:64],
            "agent_key": (agent_key or "")[:64],
        }
        body = (spec or intent or title)[:4000]

    sug = insert_config_suggestion(
        kind=kind,
        target_key=target[:120],
        title=(title or "Proposition plateforme")[:200],
        body=body,
        payload=payload,
    )
    try:
        from services.director_platform import emit_director_notification

        emit_director_notification(
            kind="config_suggestion",
            title=str(sug.get("title") or "Proposition plateforme")[:180],
            body="Spec / réglage proposé depuis le chat — à valider dans Décisions.",
            job_id=job_id or None,
            action_url="/inbox",
        )
    except Exception:
        logger.exception("notify platform change")
    return sug


def apply_config_suggestion(suggestion_id: str) -> dict[str, Any]:
    """Applique une suggestion allowlistée. Lève ValueError si hors périmètre."""
    from database import get_config_suggestion, resolve_config_suggestion

    sug = get_config_suggestion(suggestion_id)
    if not sug:
        raise ValueError("Suggestion introuvable.")
    if str(sug.get("status") or "") != "pending":
        raise ValueError("Suggestion déjà traitée.")
    if not is_applyable(sug):
        raise PermissionError("Cette recommandation n'est pas applicable automatiquement.")

    kind = str(sug.get("kind") or "")
    payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
    result: dict[str, Any] = {"applied": True, "kind": kind}

    if kind == "crm_write":
        tool = str(payload.get("tool") or "").strip()
        if tool not in CHAT_WRITE_TOOLS:
            raise PermissionError(f"Outil CRM non autorisé : {tool}")
        inp = payload.get("input") if isinstance(payload.get("input"), dict) else {}
        from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx

        token = _activate_tool_run_ctx(
            payload.get("job_id") or "",
            "proposal_apply",
            str(payload.get("agent_key") or "") or None,
            chat_mode=False,
            force_write=True,
        )
        try:
            out = _execute_tool(tool, inp)
        finally:
            _tool_run_ctx.reset(token)
        result["tool_result"] = (out or "")[:4000]
    elif kind == "behavior":
        from database import upsert_behavior_setting
        from services.behavior_defaults import behavior_default_value

        bkey = str(payload.get("behavior_key") or _behavior_key_from_target(str(sug.get("target_key") or "")))
        if bkey not in APPLYABLE_BEHAVIOR_KEYS:
            raise PermissionError(f"Clé comportement hors allowlist : {bkey}")
        value = payload.get("value")
        if value is None:
            value = behavior_default_value(bkey)
        upsert_behavior_setting(bkey, value)
        result["behavior_key"] = bkey
        result["value"] = value
    elif kind == "platform_spec":
        from services.resource_files import local_file_href, save_upload

        title = str(sug.get("title") or "spec-plateforme")[:80]
        spec = str(payload.get("spec") or sug.get("body") or "")
        md = (
            f"# {title}\n\n"
            f"{spec}\n"
        ).encode("utf-8")
        saved = save_upload(filename=f"{title}.md", mime="text/markdown", data=md)
        result["file"] = saved.get("file") if isinstance(saved, dict) else saved
        if isinstance(saved, dict) and saved.get("success"):
            fid = str((saved.get("file") or {}).get("id") or "")
            result["href"] = local_file_href(fid, inline=True) if fid else ""
    else:
        raise PermissionError(f"Kind non applicable : {kind}")

    resolved = resolve_config_suggestion(suggestion_id, "applied")
    try:
        from services.chat_intelligence import record_chat_apply_feedback

        record_chat_apply_feedback(
            title=str(sug.get("title") or kind),
            kind=kind,
            detail=str(sug.get("body") or "")[:240],
        )
    except Exception:
        logger.exception("chat apply feedback")
    out = enrich_config_suggestion(resolved or sug)
    out["apply_result"] = result
    return out


def format_proposal_tool_result(suggestion: dict[str, Any], *, kind_label: str) -> str:
    sid = str(suggestion.get("id") or "")
    title = str(suggestion.get("title") or "")
    return json.dumps(
        {
            "proposal": True,
            "status": "pending",
            "suggestion_id": sid,
            "kind": suggestion.get("kind"),
            "title": title,
            "message": (
                f"{kind_label} enregistrée (id {sid}). "
                "Aucune écriture réelle tant que le dirigeant n'a pas validé dans Décisions."
            ),
        },
        ensure_ascii=False,
    )
