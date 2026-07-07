"""
tools/__init__.py — Outils disponibles pour les agents Korymb v3.2

Chaîne de recherche web (priorité décroissante) :
  1. Tavily AI        — TAVILY_API_KEY        (1 000 req/mois gratuits, optimal agents IA)
  2. Brave Search     — BRAVE_SEARCH_API_KEY  (2 000 req/mois gratuits, résultats Google-qualité)
  3. DuckDuckGo       — sans clé              (fallback toujours disponible, 10 résultats, région FR)

Lecture de pages :
  - Jina AI Reader    — sans clé              (r.jina.ai, gère JS, retourne markdown propre)
  - httpx direct      — fallback              (sites simples, 8 000 caractères)

Nouveaux outils :
  - describe_image    — ANTHROPIC_API_KEY     (Claude Haiku vision, analyse d'images)
  - read_facebook_posts — FACEBOOK_ACCESS_TOKEN (lecture des posts de la page)
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path

import httpx

from env_loader import load_backend_env

load_backend_env()
logger = logging.getLogger(__name__)

# ── DuckDuckGo (fallback gratuit) ────────────────────────────────────────────
try:
    from duckduckgo_search import DDGS
    _DDG_AVAILABLE = True
except ImportError:
    _DDG_AVAILABLE = False

from integration_settings import getenv

# Variables lues à l'exécution via getenv() — surcharges admin > .env
_GOOGLE_TOKEN_CACHE: dict[str, float | str] = {"access_token": "", "expires_at": 0.0}


def _anthropic_key() -> str:
    k = getenv("ANTHROPIC_API_KEY")
    if k:
        return k
    try:
        from runtime_settings import merge_with_env

        return str(merge_with_env().get("anthropic_api_key") or "").strip()
    except Exception:
        return ""


def _google_oauth_bundle() -> tuple[str, str, str, str]:
    return (
        getenv("GOOGLE_OAUTH_REFRESH_TOKEN"),
        getenv("GOOGLE_OAUTH_CLIENT_ID"),
        getenv("GOOGLE_OAUTH_CLIENT_SECRET"),
        getenv("GOOGLE_OAUTH_TOKEN_ENDPOINT") or "https://oauth2.googleapis.com/token",
    )


def _gdrive_token_static() -> str:
    return (getenv("GOOGLE_DRIVE_ACCESS_TOKEN") or getenv("GOOGLE_API_ACCESS_TOKEN")).strip()


# ═══════════════════════════════════════════════════════════════════════════════
#  WEB SEARCH — chaîne Tavily → Brave → DuckDuckGo
# ═══════════════════════════════════════════════════════════════════════════════

def _format_results(results: list[dict], provider: str) -> str:
    if not results:
        return f"Aucun résultat ({provider})."
    parts = [f"*Source : {provider} — {len(results)} résultats*\n"]
    for r in results:
        title   = str(r.get("title") or "").strip()
        url     = str(r.get("url") or r.get("href") or "").strip()
        content = str(r.get("content") or r.get("body") or r.get("snippet") or "").strip()
        parts.append(f"**{title}**\n{url}\n{content[:400]}")
    return "\n\n".join(parts)


def _search_tavily(query: str, max_results: int = 10) -> list[dict] | None:
    if not getenv("TAVILY_API_KEY"):
        return None
    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": getenv("TAVILY_API_KEY"),
                "query": query,
                "search_depth": "basic",
                "max_results": max_results,
                "include_raw_content": False,
                "include_answer": False,
            },
            timeout=20,
        )
        if resp.status_code == 200:
            return resp.json().get("results") or []
        logger.warning("Tavily HTTP %s : %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("Tavily error : %s", e)
    return None


def _search_brave(query: str, max_results: int = 10) -> list[dict] | None:
    if not getenv("BRAVE_SEARCH_API_KEY"):
        return None
    try:
        resp = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": min(max_results, 20), "country": "fr", "search_lang": "fr"},
            headers={"Accept": "application/json", "X-Subscription-Token": getenv("BRAVE_SEARCH_API_KEY")},
            timeout=20,
        )
        if resp.status_code == 200:
            raw = resp.json().get("web", {}).get("results") or []
            return [
                {"title": r.get("title"), "url": r.get("url"), "content": r.get("description")}
                for r in raw
            ]
        logger.warning("Brave HTTP %s : %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("Brave error : %s", e)
    return None


def _search_ddg(query: str, max_results: int = 10) -> list[dict] | None:
    if not _DDG_AVAILABLE:
        return None
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(
                query,
                max_results=max_results,
                region="fr-fr",
                safesearch="off",
            ))
        return [{"title": r.get("title"), "url": r.get("href"), "content": r.get("body")} for r in results]
    except Exception as e:
        logger.warning("DuckDuckGo error : %s", e)
    return None


def run_web_search(query: str, max_results: int = 10) -> str:
    """
    Recherche web multi-provider (Tavily → Brave → DuckDuckGo).
    Retourne jusqu'à 10 résultats avec titre, URL et extrait.
    """
    q = (query or "").strip()[:600]
    if not q:
        return "Requête vide."

    # 1. Tavily (meilleur pour les agents IA)
    res = _search_tavily(q, max_results)
    if res is not None:
        return _format_results(res, "Tavily")

    # 2. Brave Search (excellent coverage FR)
    res = _search_brave(q, max_results)
    if res is not None:
        return _format_results(res, "Brave Search")

    # 3. DuckDuckGo (fallback)
    res = _search_ddg(q, max_results)
    if res is not None:
        return _format_results(res, "DuckDuckGo")

    return "Erreur recherche : aucun provider disponible (DuckDuckGo, Brave, Tavily). Vérifiez la connexion."


# ═══════════════════════════════════════════════════════════════════════════════
#  READ WEBPAGE — Jina AI Reader (JS) + httpx direct (fallback)
# ═══════════════════════════════════════════════════════════════════════════════

_JINA_BASE = "https://r.jina.ai/"
_PAGE_LIMIT = 8_000


def _read_via_jina(url: str) -> str | None:
    """Jina AI Reader : rend le JS, retourne du markdown propre. Gratuit, sans clé."""
    try:
        resp = httpx.get(
            f"{_JINA_BASE}{url}",
            headers={
                "Accept": "text/plain",
                "User-Agent": "Mozilla/5.0 (compatible; KorymbAgent/3.1)",
                "X-Return-Format": "text",
            },
            timeout=30,
            follow_redirects=True,
        )
        if resp.status_code == 200:
            text = resp.text.strip()
            if len(text) > 60:
                return text[:_PAGE_LIMIT] + ("…" if len(text) > _PAGE_LIMIT else "")
    except Exception as e:
        logger.debug("Jina reader error for %s : %s", url, e)
    return None


def _read_via_httpx(url: str) -> str | None:
    """Lecture directe httpx — fonctionne sur les pages HTML simples."""
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        }
        resp = httpx.get(url, headers=headers, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) > 60:
            return text[:_PAGE_LIMIT] + ("…" if len(text) > _PAGE_LIMIT else "")
    except Exception as e:
        logger.debug("httpx read error for %s : %s", url, e)
    return None


def run_read_webpage(url: str) -> str:
    """
    Extrait le texte d'une page web.
    Priorité : Jina AI Reader (gère JS) → httpx direct.
    Limite : 8 000 caractères.
    """
    u = (url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        return "URL refusée : uniquement http:// ou https://"

    text = _read_via_jina(u)
    if text:
        return f"[Jina Reader]\n{text}"

    text = _read_via_httpx(u)
    if text:
        return text

    return f"Impossible de lire {u} : page inaccessible ou contenu non textuel."


# ═══════════════════════════════════════════════════════════════════════════════
#  LINKEDIN — recherche multi-stratégie + lecture Jina
# ═══════════════════════════════════════════════════════════════════════════════

def run_search_linkedin(query: str) -> str:
    """
    Recherche profils et pages LinkedIn publics.
    Stratégie : recherche web ciblée site:linkedin.com/in (profils) +
                site:linkedin.com/company (entreprises) via le meilleur provider disponible.
    """
    q = (query or "").strip()[:400]
    if not q:
        return "Requête vide."

    # Deux requêtes : profils individuels + pages entreprises
    results_parts: list[str] = []

    q_profils    = f'site:linkedin.com/in {q}'
    q_companies  = f'site:linkedin.com/company {q}'

    for lq, label in [(q_profils, "Profils"), (q_companies, "Entreprises")]:
        res = _search_tavily(lq, 6) or _search_brave(lq, 6) or _search_ddg(lq, 6)
        if res:
            results_parts.append(f"### {label} LinkedIn\n{_format_results(res, 'web')}")

    if not results_parts:
        return f"Aucun résultat LinkedIn pour : {q}"

    return "\n\n".join(results_parts) + (
        "\n\n*Conseil : utilisez `read_webpage` sur les URLs linkedin.com/in/... "
        "pour obtenir plus de détails sur un profil spécifique.*"
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  DESCRIBE IMAGE — Claude Haiku Vision (via ANTHROPIC_API_KEY)
# ═══════════════════════════════════════════════════════════════════════════════

def run_describe_image(image_url: str, context: str = "") -> str:
    """
    Analyse et décrit le contenu d'une image via Claude Haiku Vision.
    Fonctionne avec : photos Instagram, posts Facebook, affiches, cartes tarot, logos, etc.
    Nécessite ANTHROPIC_API_KEY.
    """
    url = (image_url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return "URL image invalide (doit commencer par http:// ou https://)."

    if not _anthropic_key():
        return "ANTHROPIC_API_KEY non configuré — impossible d'analyser l'image."

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=_anthropic_key())
        prompt = (
            "Décris précisément le contenu de cette image en français : "
            "personnes, textes visibles, couleurs, ambiance, contexte, émotions, "
            "éléments marketing ou symboliques. "
            "Sois concis mais complet (5 à 10 lignes)."
        )
        if context:
            prompt += f"\n\nContexte fourni : {context}"

        resp = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "url", "url": url}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        blocks = resp.content or []
        text = " ".join(
            getattr(b, "text", "") or (b.get("text", "") if isinstance(b, dict) else "")
            for b in blocks
        ).strip()
        return f"[Analyse image]\n{text}" if text else "Aucune description générée."
    except Exception as e:
        return f"Erreur analyse image : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  INSTAGRAM — post + lecture des médias de la page
# ═══════════════════════════════════════════════════════════════════════════════

def run_post_instagram(caption: str, image_url: str = "") -> str:
    ig_token = getenv("INSTAGRAM_ACCESS_TOKEN")
    ig_account = getenv("INSTAGRAM_ACCOUNT_ID")
    if not ig_token or not ig_account:
        return (
            "[SIMULATION] Post Instagram prêt à publier :\n"
            f"Caption : {caption}\n"
            "⚠️ Configure INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env pour publier réellement."
        )
    try:
        payload: dict = {"caption": caption, "access_token": ig_token}
        if image_url:
            payload["image_url"] = image_url
            payload["media_type"] = "IMAGE"
        else:
            payload["media_type"] = "REELS"
        r = httpx.post(
            f"https://graph.facebook.com/v19.0/{ig_account}/media",
            data=payload,
            timeout=20,
        )
        r.raise_for_status()
        container_id = r.json().get("id")
        r2 = httpx.post(
            f"https://graph.facebook.com/v19.0/{ig_account}/media_publish",
            data={"creation_id": container_id, "access_token": ig_token},
            timeout=20,
        )
        r2.raise_for_status()
        return f"✅ Post Instagram publié (id: {r2.json().get('id')})"
    except Exception as e:
        return f"Erreur Instagram : {e}"


def run_read_instagram_media(limit: int = 10) -> str:
    """Lit les derniers médias publiés sur le compte Instagram configuré."""
    ig_token = getenv("INSTAGRAM_ACCESS_TOKEN")
    ig_account = getenv("INSTAGRAM_ACCOUNT_ID")
    if not ig_token or not ig_account:
        return "INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_ACCOUNT_ID non configuré."
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/v19.0/{ig_account}/media",
            params={
                "access_token": ig_token,
                "fields": "id,caption,media_type,timestamp,permalink,thumbnail_url,media_url",
                "limit": min(limit, 20),
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return "Aucun média trouvé sur ce compte Instagram."
        lines = [f"Derniers médias Instagram ({len(data)}) :"]
        for m in data:
            ts    = (m.get("timestamp") or "")[:10]
            mtype = m.get("media_type", "")
            cap   = (m.get("caption") or "(sans légende)")[:200]
            url   = m.get("permalink", "")
            img   = m.get("media_url") or m.get("thumbnail_url") or ""
            lines.append(f"\n[{ts}] {mtype} — {cap}")
            if url:
                lines.append(f"  Lien : {url}")
            if img:
                lines.append(f"  Image : {img}")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur lecture Instagram : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  FACEBOOK — post + lecture des posts de la page
# ═══════════════════════════════════════════════════════════════════════════════

def run_post_facebook(message: str) -> str:
    fb_token = getenv("FACEBOOK_ACCESS_TOKEN")
    fb_page = getenv("FACEBOOK_PAGE_ID")
    if not fb_token or not fb_page:
        return (
            "[SIMULATION] Post Facebook prêt :\n"
            f"{message}\n"
            "⚠️ Configure FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env pour publier réellement."
        )
    try:
        r = httpx.post(
            f"https://graph.facebook.com/v19.0/{fb_page}/feed",
            data={"message": message, "access_token": fb_token},
            timeout=20,
        )
        r.raise_for_status()
        return f"✅ Post Facebook publié (id: {r.json().get('id')})"
    except Exception as e:
        return f"Erreur Facebook : {e}"


def run_read_facebook_posts(limit: int = 10) -> str:
    """Lit les derniers posts de la page Facebook configurée."""
    fb_token = getenv("FACEBOOK_ACCESS_TOKEN")
    fb_page = getenv("FACEBOOK_PAGE_ID")
    if not fb_token:
        return "FACEBOOK_ACCESS_TOKEN non configuré."
    if not fb_page:
        return "FACEBOOK_PAGE_ID non configuré."
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/v19.0/{fb_page}/posts",
            params={
                "access_token": fb_token,
                "fields": "message,story,created_time,permalink_url,full_picture",
                "limit": min(limit, 25),
            },
            timeout=20,
        )
        resp.raise_for_status()
        posts = resp.json().get("data") or []
        if not posts:
            return "Aucun post trouvé sur cette page Facebook."
        lines = [f"Derniers posts Facebook ({len(posts)}) :"]
        for p in posts:
            ts  = (p.get("created_time") or "")[:10]
            msg = (p.get("message") or p.get("story") or "(sans texte)")[:300]
            url = p.get("permalink_url", "")
            img = p.get("full_picture", "")
            lines.append(f"\n[{ts}] {msg}")
            if url:
                lines.append(f"  Lien : {url}")
            if img:
                lines.append(f"  Image : {img}")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur lecture Facebook : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  EMAIL — SMTP ou simulation
# ═══════════════════════════════════════════════════════════════════════════════

def run_send_email(to: str, subject: str, body: str) -> str:
    smtp_host = getenv("SMTP_HOST")
    smtp_user = getenv("SMTP_USER")
    smtp_pass = getenv("SMTP_PASS")
    if not smtp_host:
        return (
            f"[SIMULATION] Email prêt :\n"
            f"À : {to}\nObjet : {subject}\n\n{body}\n\n"
            "⚠️ Configure SMTP_HOST, SMTP_USER, SMTP_PASS dans .env pour envoyer réellement."
        )
    try:
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = smtp_user
        msg["To"] = to
        with smtplib.SMTP_SSL(smtp_host, 465) as s:
            s.login(smtp_user, smtp_pass)
            s.send_message(msg)
        return f"✅ Email envoyé à {to}"
    except Exception as e:
        return f"Erreur email : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE DRIVE — upload avec refresh token OAuth
# ═══════════════════════════════════════════════════════════════════════════════

def _refresh_google_access_token(force: bool = False) -> str:
    refresh, client_id, client_secret, token_endpoint = _google_oauth_bundle()
    if not (refresh and client_id and client_secret):
        return ""
    now = time.time()
    cached = str(_GOOGLE_TOKEN_CACHE.get("access_token") or "")
    exp = float(_GOOGLE_TOKEN_CACHE.get("expires_at") or 0.0)
    if (not force) and cached and exp > now + 30:
        return cached
    try:
        r = httpx.post(
            token_endpoint,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            timeout=12,
        )
        r.raise_for_status()
        data = r.json() if r.content else {}
        token = str(data.get("access_token") or "").strip()
        if not token:
            return ""
        expires_in = int(data.get("expires_in") or 3600)
        _GOOGLE_TOKEN_CACHE["access_token"] = token
        _GOOGLE_TOKEN_CACHE["expires_at"] = now + max(60, expires_in - 30)
        return token
    except Exception:
        logger.exception("google_oauth_refresh_failed")
        return ""


def _get_google_drive_token() -> str:
    refresh, client_id, client_secret, _ = _google_oauth_bundle()
    if refresh and client_id and client_secret:
        refreshed = _refresh_google_access_token(force=False)
        if refreshed:
            return refreshed
    static = _gdrive_token_static()
    if static:
        return static
    return _refresh_google_access_token(force=False) or ""


def _drive_multipart_upload(
    *,
    filename: str,
    content: str,
    source_mime: str,
    target_mime: str = "",
    folder_id: str = "",
    convert: bool = False,
) -> dict[str, str]:
    """Upload Drive v3 multipart. Retourne {id, name, webViewLink, mimeType} ou lève."""
    token = _get_google_drive_token()
    if not token:
        raise RuntimeError(
            "Google Drive non configuré (GOOGLE_API_ACCESS_TOKEN ou OAuth refresh + client id/secret)."
        )
    fn = (filename or "").strip()[:220]
    if not fn:
        raise ValueError("Nom de fichier vide.")
    effective_folder = (folder_id or getenv("GOOGLE_DRIVE_FOLDER_ID") or "").strip()
    parent_json = f', "parents": ["{effective_folder}"]' if effective_folder else ""
    meta_mime = (target_mime or source_mime or "text/plain").strip()
    metadata = f'{{"name":{json.dumps(fn)}{parent_json}, "mimeType":{json.dumps(meta_mime)}}}'
    safe_src = (source_mime or "text/plain").strip() or "text/plain"
    boundary = "korymb_drive_boundary"
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\nContent-Type: {safe_src}; charset=UTF-8\r\n\r\n"
        f"{content or ''}\r\n"
        f"--{boundary}--\r\n"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/related; boundary={boundary}",
    }
    url = (
        "https://www.googleapis.com/upload/drive/v3/files"
        "?uploadType=multipart&fields=id,name,webViewLink,mimeType"
    )
    if convert:
        url += "&convert=true"
    r = httpx.post(url, headers=headers, content=body.encode("utf-8"), timeout=45)
    if r.status_code == 401:
        refresh, client_id, client_secret, _ = _google_oauth_bundle()
        if refresh and client_id and client_secret:
            refreshed = _refresh_google_access_token(force=True)
            if refreshed:
                headers["Authorization"] = f"Bearer {refreshed}"
                r = httpx.post(url, headers=headers, content=body.encode("utf-8"), timeout=45)
    r.raise_for_status()
    data = r.json() if r.content else {}
    return {
        "id": str(data.get("id") or ""),
        "name": str(data.get("name") or fn),
        "webViewLink": str(data.get("webViewLink") or ""),
        "mimeType": str(data.get("mimeType") or meta_mime),
    }


def _markdown_table_to_csv(text: str) -> str | None:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip().startswith("|")]
    if len(lines) < 2:
        return None
    rows: list[list[str]] = []
    for ln in lines:
        if re.match(r"^\|[\s\-:|]+\|$", ln):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if cells:
            rows.append(cells)
    if not rows:
        return None
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def run_create_drive_deliverable(
    title: str,
    content: str,
    *,
    format_kind: str = "auto",
    folder_id: str = "",
) -> str:
    """
    Crée un livrable sur Google Drive (texte, CSV, Google Sheet ou Google Doc).
    format_kind : auto | text | csv | sheet | doc
    """
    title = (title or "").strip()[:200] or "Livrable Korymb"
    body = content or ""
    fk = (format_kind or "auto").strip().lower()
    blob = _ascii_fold(f"{title}\n{body[:800]}")
    if fk == "auto":
        if "|" in body and re.search(r"^\|.+\|", body, re.MULTILINE):
            fk = "sheet"
        elif any(
            h in blob
            for h in (
                "objet:",
                "madame",
                "monsieur",
                "cher ",
                "chere ",
                "chère ",
                "cordialement",
            )
        ):
            fk = "doc"
        elif any(h in blob for h in ("tableau", "csv", "profils", "liste")) and "|" in body:
            fk = "sheet"
        else:
            fk = "text"
    if fk in ("sheet", "csv") or ("|" in body and fk == "auto"):
        from services.drive_workspace import validate_sheet_export_content

        ok, reason = validate_sheet_export_content(body)
        if not ok:
            return f"Erreur Google Drive : {reason}"
    try:
        if fk == "sheet":
            csv_body = body
            if "|" in body and not body.lstrip().startswith(","):
                parsed = _markdown_table_to_csv(body)
                if parsed:
                    csv_body = parsed
            if not title.lower().endswith(".csv"):
                upload_name = f"{title}.csv" if not title.lower().endswith(".csv") else title
            else:
                upload_name = title
            data = _drive_multipart_upload(
                filename=upload_name,
                content=csv_body,
                source_mime="text/csv",
                target_mime="application/vnd.google-apps.spreadsheet",
                folder_id=folder_id,
                convert=True,
            )
        elif fk == "doc":
            upload_name = title if title.lower().endswith((".md", ".txt")) else f"{title}.md"
            data = _drive_multipart_upload(
                filename=upload_name,
                content=body,
                source_mime="text/markdown",
                target_mime="application/vnd.google-apps.document",
                folder_id=folder_id,
                convert=True,
            )
        elif fk == "csv":
            upload_name = title if title.lower().endswith(".csv") else f"{title}.csv"
            data = _drive_multipart_upload(
                filename=upload_name,
                content=body,
                source_mime="text/csv",
                target_mime="text/csv",
                folder_id=folder_id,
            )
        else:
            upload_name = title if "." in title else f"{title}.md"
            data = _drive_multipart_upload(
                filename=upload_name,
                content=body,
                source_mime="text/markdown",
                target_mime="text/markdown",
                folder_id=folder_id,
            )
        fid = data.get("id") or "?"
        name = data.get("name") or upload_name
        link = data.get("webViewLink") or ""
        return f"✅ Fichier Drive créé : {name} (id: {fid})\n{link}" if link else f"✅ Fichier Drive créé : {name} (id: {fid})"
    except Exception as e:
        return f"Erreur Google Drive : {e}"


def _ascii_fold(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def run_upload_google_drive(
    filename: str,
    content: str,
    mime_type: str = "text/plain",
    folder_id: str = "",
) -> str:
    fn = (filename or "").strip()[:220]
    if not fn:
        return "Nom de fichier vide."
    body = content or ""
    if "|" in body and re.search(r"^\|.+\|", body, re.MULTILINE):
        title = fn.rsplit(".", 1)[0] if "." in fn else fn
        return run_create_drive_deliverable(
            title=title,
            content=body,
            format_kind="sheet",
            folder_id=folder_id,
        )
    try:
        data = _drive_multipart_upload(
            filename=fn,
            content=body,
            source_mime=(mime_type or "text/plain").strip() or "text/plain",
            target_mime=(mime_type or "text/plain").strip() or "text/plain",
            folder_id=folder_id,
        )
        fid = data.get("id") or "?"
        name = data.get("name") or fn
        link = data.get("webViewLink") or ""
        return f"✅ Fichier Drive créé : {name} (id: {fid})\n{link}" if link else f"✅ Fichier Drive créé : {name} (id: {fid})"
    except Exception as e:
        return f"Erreur Google Drive : {e}"
