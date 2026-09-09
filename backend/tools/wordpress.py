"""WordPress REST — brouillon à la préparation, publish après validation."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from integration_settings import getenv

logger = logging.getLogger(__name__)


def wordpress_configured() -> bool:
    return bool(
        (getenv("WP_BASE_URL") or "").strip()
        and (getenv("WP_USER") or "").strip()
        and (getenv("WP_APP_PASSWORD") or "").strip()
    )


def _base() -> str:
    return (getenv("WP_BASE_URL") or "").strip().rstrip("/")


def _auth() -> tuple[str, str]:
    return ((getenv("WP_USER") or "").strip(), (getenv("WP_APP_PASSWORD") or "").strip())


def run_wordpress_create_post(
    title: str,
    content: str,
    excerpt: str = "",
    status: str = "draft",
) -> str:
    title_c = (title or "").strip()
    html = (content or "").strip()
    if not title_c or not html:
        return "Erreur: titre et contenu WordPress requis."
    if not wordpress_configured():
        return (
            f"[SIMULATION] Article WordPress ({status}) :\n"
            f"Titre : {title_c}\n\n{html[:800]}\n\n"
            "⚠️ Configure WP_BASE_URL, WP_USER, WP_APP_PASSWORD pour publier réellement."
        )
    st = (status or "draft").strip().lower()
    if st not in ("draft", "publish"):
        st = "draft"
    try:
        r = httpx.post(
            f"{_base()}/wp-json/wp/v2/posts",
            auth=_auth(),
            json={
                "title": title_c[:200],
                "content": html,
                "excerpt": (excerpt or "")[:500],
                "status": st,
            },
            timeout=25,
        )
        r.raise_for_status()
        data = r.json() if r.content else {}
        pid = data.get("id")
        link = data.get("link") or data.get("guid", {}).get("rendered") or ""
        return f"✅ Article WordPress {st} (id: {pid})\n{link}"
    except Exception as e:
        logger.exception("wordpress_create_post failed")
        return f"Erreur WordPress : {e}"


def run_wordpress_publish(post_id: int | str) -> str:
    pid = str(post_id or "").strip()
    if not pid:
        return "Erreur: post_id WordPress manquant."
    if not wordpress_configured():
        return f"[SIMULATION] Publication WordPress id={pid}."
    try:
        r = httpx.post(
            f"{_base()}/wp-json/wp/v2/posts/{pid}",
            auth=_auth(),
            json={"status": "publish"},
            timeout=25,
        )
        r.raise_for_status()
        data = r.json() if r.content else {}
        link = data.get("link") or ""
        return f"✅ Article WordPress publié (id: {pid})\n{link}"
    except Exception as e:
        logger.exception("wordpress_publish failed")
        return f"Erreur WordPress : {e}"


def parse_wordpress_result(text: str) -> dict[str, Any]:
    """Extrait id + lien depuis le texte outil."""
    out: dict[str, Any] = {"raw": (text or "")[:500]}
    import re

    m = re.search(r"id:\s*(\d+)", text or "", re.I)
    if m:
        out["wp_post_id"] = m.group(1)
    for token in (text or "").split():
        if token.startswith("http"):
            out["link"] = token.strip()
            break
    return out
