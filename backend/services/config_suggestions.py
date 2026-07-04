"""Recommandations de configuration système (lecture seule, sans écriture auto)."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_INTEGRATION_TOOL_MAP: dict[str, str] = {
    "web_search": "integration:web_search",
    "read_webpage": "integration:read_webpage",
    "instagram": "integration:instagram",
    "facebook": "integration:facebook",
    "google_drive": "integration:google_drive",
    "smtp_email": "integration:smtp",
    "generate_image": "integration:image_gen",
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

    return list_config_suggestions(status="pending", limit=limit)
