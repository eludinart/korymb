"""
tools/__init__.py — Outils disponibles pour les agents Korymb v3.1

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
from crewai.tools import tool
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
logger = logging.getLogger(__name__)

# ── DuckDuckGo (fallback gratuit) ────────────────────────────────────────────
try:
    from duckduckgo_search import DDGS
    _DDG_AVAILABLE = True
except ImportError:
    _DDG_AVAILABLE = False

# ── Clés API ─────────────────────────────────────────────────────────────────
_TAVILY_KEY        = os.getenv("TAVILY_API_KEY", "").strip()
_BRAVE_KEY         = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
_ANTHROPIC_KEY     = os.getenv("ANTHROPIC_API_KEY", "").strip()
_IG_TOKEN          = os.getenv("INSTAGRAM_ACCESS_TOKEN", "").strip()
_IG_ACCOUNT_ID     = os.getenv("INSTAGRAM_ACCOUNT_ID", "").strip()
_FB_TOKEN          = os.getenv("FACEBOOK_ACCESS_TOKEN", "").strip()
_FB_PAGE_ID        = os.getenv("FACEBOOK_PAGE_ID", "").strip()
_SMTP_HOST         = os.getenv("SMTP_HOST", "")
_SMTP_USER         = os.getenv("SMTP_USER", "")
_SMTP_PASS         = os.getenv("SMTP_PASS", "")
_GDRIVE_TOKEN      = (os.getenv("GOOGLE_DRIVE_ACCESS_TOKEN", "") or os.getenv("GOOGLE_API_ACCESS_TOKEN", "")).strip()
_GDRIVE_FOLDER_ID  = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "")
_GOOGLE_REFRESH_TOKEN   = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "").strip()
_GOOGLE_CLIENT_ID       = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
_GOOGLE_CLIENT_SECRET   = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
_GOOGLE_TOKEN_ENDPOINT  = os.getenv("GOOGLE_OAUTH_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token").strip()
_GOOGLE_TOKEN_CACHE: dict[str, float | str] = {"access_token": "", "expires_at": 0.0}


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
    if not _TAVILY_KEY:
        return None
    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": _TAVILY_KEY,
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
    if not _BRAVE_KEY:
        return None
    try:
        resp = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": min(max_results, 20), "country": "fr", "search_lang": "fr"},
            headers={"Accept": "application/json", "X-Subscription-Token": _BRAVE_KEY},
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


@tool("Recherche web")
def web_search(query: str) -> str:
    """
    Effectue une recherche web multi-provider (Tavily, Brave Search, DuckDuckGo).
    Retourne 10 résultats avec titre, URL et extrait pour chaque.
    Utilise pour : prospects, actualités, concurrents, tendances marché, annuaires,
    profils publics, articles de blog, pages entreprises.
    """
    return run_web_search(query)


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


@tool("Lire une page web")
def read_webpage(url: str) -> str:
    """
    Lit le contenu textuel d'une page web à partir de son URL.
    Gère les pages JavaScript modernes via Jina AI Reader.
    Retourne jusqu'à 8 000 caractères de contenu propre.
    Utilise pour : profils LinkedIn publics, fiches thérapeutes, pages entreprises, articles.
    """
    return run_read_webpage(url)


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


@tool("Rechercher sur LinkedIn")
def search_linkedin(query: str) -> str:
    """
    Recherche des profils professionnels et pages entreprises sur LinkedIn (résultats publics).
    Retourne des profils individuels (linkedin.com/in/) et entreprises (linkedin.com/company/).
    Pour plus de détails sur un profil : utilisez read_webpage avec l'URL trouvée.
    """
    return run_search_linkedin(query)


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

    if not _ANTHROPIC_KEY:
        return "ANTHROPIC_API_KEY non configuré — impossible d'analyser l'image."

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=_ANTHROPIC_KEY)
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


@tool("Analyser une image")
def describe_image(image_url: str, context: str = "") -> str:
    """
    Analyse et décrit le contenu visuel d'une image (URL publique http/https).
    Utile pour : analyser des posts Instagram/Facebook, comprendre des visuels
    de concurrents, décrire des cartes tarot, lire du texte dans une image.
    context : contexte optionnel pour guider l'analyse.
    """
    return run_describe_image(image_url, context)


# ═══════════════════════════════════════════════════════════════════════════════
#  INSTAGRAM — post + lecture des médias de la page
# ═══════════════════════════════════════════════════════════════════════════════

def run_post_instagram(caption: str, image_url: str = "") -> str:
    if not _IG_TOKEN or not _IG_ACCOUNT_ID:
        return (
            "[SIMULATION] Post Instagram prêt à publier :\n"
            f"Caption : {caption}\n"
            "⚠️ Configure INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env pour publier réellement."
        )
    try:
        payload: dict = {"caption": caption, "access_token": _IG_TOKEN}
        if image_url:
            payload["image_url"] = image_url
            payload["media_type"] = "IMAGE"
        else:
            payload["media_type"] = "REELS"
        r = httpx.post(
            f"https://graph.facebook.com/v19.0/{_IG_ACCOUNT_ID}/media",
            data=payload,
            timeout=20,
        )
        r.raise_for_status()
        container_id = r.json().get("id")
        r2 = httpx.post(
            f"https://graph.facebook.com/v19.0/{_IG_ACCOUNT_ID}/media_publish",
            data={"creation_id": container_id, "access_token": _IG_TOKEN},
            timeout=20,
        )
        r2.raise_for_status()
        return f"✅ Post Instagram publié (id: {r2.json().get('id')})"
    except Exception as e:
        return f"Erreur Instagram : {e}"


def run_read_instagram_media(limit: int = 10) -> str:
    """Lit les derniers médias publiés sur le compte Instagram configuré."""
    if not _IG_TOKEN or not _IG_ACCOUNT_ID:
        return "INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_ACCOUNT_ID non configuré."
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/v19.0/{_IG_ACCOUNT_ID}/media",
            params={
                "access_token": _IG_TOKEN,
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


@tool("Publier sur Instagram")
def post_instagram(caption: str, image_url: str = "") -> str:
    """
    Publie un post sur le compte Instagram d'Élude In Art.
    caption : texte du post (avec hashtags).
    image_url : URL publique de l'image (optionnel).
    Nécessite INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env.
    """
    return run_post_instagram(caption, image_url)


@tool("Lire les médias Instagram")
def read_instagram_media(limit: int = 10) -> str:
    """
    Lit les derniers médias publiés sur le compte Instagram d'Élude In Art.
    Retourne caption, type de média, date, lien et URL image pour chaque post.
    Utile pour : auditer la présence Instagram, éviter les doublons, analyser les contenus passés.
    """
    return run_read_instagram_media(limit)


# ═══════════════════════════════════════════════════════════════════════════════
#  FACEBOOK — post + lecture des posts de la page
# ═══════════════════════════════════════════════════════════════════════════════

def run_post_facebook(message: str) -> str:
    if not _FB_TOKEN or not _FB_PAGE_ID:
        return (
            "[SIMULATION] Post Facebook prêt :\n"
            f"{message}\n"
            "⚠️ Configure FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env pour publier réellement."
        )
    try:
        r = httpx.post(
            f"https://graph.facebook.com/v19.0/{_FB_PAGE_ID}/feed",
            data={"message": message, "access_token": _FB_TOKEN},
            timeout=20,
        )
        r.raise_for_status()
        return f"✅ Post Facebook publié (id: {r.json().get('id')})"
    except Exception as e:
        return f"Erreur Facebook : {e}"


def run_read_facebook_posts(limit: int = 10) -> str:
    """Lit les derniers posts de la page Facebook configurée."""
    if not _FB_TOKEN:
        return "FACEBOOK_ACCESS_TOKEN non configuré."
    if not _FB_PAGE_ID:
        return "FACEBOOK_PAGE_ID non configuré."
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/v19.0/{_FB_PAGE_ID}/posts",
            params={
                "access_token": _FB_TOKEN,
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


@tool("Publier sur Facebook")
def post_facebook(message: str) -> str:
    """
    Publie un post sur la page Facebook d'Élude In Art.
    Nécessite FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env.
    """
    return run_post_facebook(message)


@tool("Lire les posts Facebook")
def read_facebook_posts(limit: int = 10) -> str:
    """
    Lit les derniers posts de la page Facebook d'Élude In Art.
    Retourne le texte, la date, le lien et l'image de chaque post.
    Utile pour : auditer la présence Facebook, éviter les doublons, analyser les contenus.
    """
    return run_read_facebook_posts(limit)


# ═══════════════════════════════════════════════════════════════════════════════
#  EMAIL — SMTP ou simulation
# ═══════════════════════════════════════════════════════════════════════════════

def run_send_email(to: str, subject: str, body: str) -> str:
    if not _SMTP_HOST:
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
        msg["From"] = _SMTP_USER
        msg["To"] = to
        with smtplib.SMTP_SSL(_SMTP_HOST, 465) as s:
            s.login(_SMTP_USER, _SMTP_PASS)
            s.send_message(msg)
        return f"✅ Email envoyé à {to}"
    except Exception as e:
        return f"Erreur email : {e}"


@tool("Envoyer un email")
def send_email(to: str, subject: str, body: str) -> str:
    """
    Envoie un email de prospection ou suivi.
    Nécessite SMTP_HOST, SMTP_USER, SMTP_PASS dans .env.
    Sans SMTP configuré : génère le brouillon (simulation).
    """
    return run_send_email(to, subject, body)


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE DRIVE — upload avec refresh token OAuth
# ═══════════════════════════════════════════════════════════════════════════════

def _refresh_google_access_token(force: bool = False) -> str:
    if not (_GOOGLE_REFRESH_TOKEN and _GOOGLE_CLIENT_ID and _GOOGLE_CLIENT_SECRET):
        return ""
    now = time.time()
    cached = str(_GOOGLE_TOKEN_CACHE.get("access_token") or "")
    exp = float(_GOOGLE_TOKEN_CACHE.get("expires_at") or 0.0)
    if (not force) and cached and exp > now + 30:
        return cached
    try:
        r = httpx.post(
            _GOOGLE_TOKEN_ENDPOINT,
            data={
                "grant_type": "refresh_token",
                "refresh_token": _GOOGLE_REFRESH_TOKEN,
                "client_id": _GOOGLE_CLIENT_ID,
                "client_secret": _GOOGLE_CLIENT_SECRET,
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
    if _GDRIVE_TOKEN:
        return _GDRIVE_TOKEN
    return _refresh_google_access_token(force=False) or ""


def run_upload_google_drive(
    filename: str,
    content: str,
    mime_type: str = "text/plain",
    folder_id: str = "",
) -> str:
    fn = (filename or "").strip()[:220]
    if not fn:
        return "Nom de fichier vide."
    token = _get_google_drive_token()
    if not token:
        return (
            "[SIMULATION] Fichier Drive prêt :\n"
            f"Nom : {fn}\nMIME : {mime_type or 'text/plain'}\n"
            f"Taille : {len(content or '')} caractères\n"
            "⚠️ Configure GOOGLE_API_ACCESS_TOKEN ou GOOGLE_OAUTH_REFRESH_TOKEN+CLIENT_ID+CLIENT_SECRET dans .env."
        )
    effective_folder = (folder_id or _GDRIVE_FOLDER_ID or "").strip()
    parent_json = f', "parents": ["{effective_folder}"]' if effective_folder else ""
    safe_mime = (mime_type or "text/plain").strip() or "text/plain"
    boundary = "korymb_drive_boundary"
    metadata = f'{{"name":"{fn}"{parent_json}}}'
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\nContent-Type: {safe_mime}; charset=UTF-8\r\n\r\n"
        f"{content or ''}\r\n"
        f"--{boundary}--\r\n"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/related; boundary={boundary}",
    }
    try:
        r = httpx.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
            headers=headers,
            content=body.encode("utf-8"),
            timeout=25,
        )
        if r.status_code == 401 and (_GOOGLE_REFRESH_TOKEN and _GOOGLE_CLIENT_ID and _GOOGLE_CLIENT_SECRET):
            refreshed = _refresh_google_access_token(force=True)
            if refreshed:
                headers["Authorization"] = f"Bearer {refreshed}"
                r = httpx.post(
                    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
                    headers=headers,
                    content=body.encode("utf-8"),
                    timeout=25,
                )
        r.raise_for_status()
        data = r.json() if r.content else {}
        fid  = data.get("id") or "?"
        name = data.get("name") or fn
        link = data.get("webViewLink")
        return f"✅ Fichier Drive créé : {name} (id: {fid})\n{link}" if link else f"✅ Fichier Drive créé : {name} (id: {fid})"
    except Exception as e:
        return f"Erreur Google Drive : {e}"


@tool("Créer un fichier sur Google Drive")
def upload_google_drive(
    filename: str,
    content: str,
    mime_type: str = "text/plain",
    folder_id: str = "",
) -> str:
    """
    Crée un fichier texte ou markdown sur Google Drive d'Élude In Art.
    Nécessite GOOGLE_API_ACCESS_TOKEN ou GOOGLE_OAUTH_REFRESH_TOKEN+CLIENT_ID+CLIENT_SECRET dans .env.
    """
    return run_upload_google_drive(filename, content, mime_type, folder_id)
