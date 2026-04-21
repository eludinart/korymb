"""
tools.py — Outils disponibles pour les agents Korymb.
Les fonctions run_* sont appelées par le flux v3 (tool use) et par les décorateurs @tool CrewAI.
"""
import os
import re
import time
import logging
import httpx
from crewai.tools import tool
from pathlib import Path
from dotenv import load_dotenv

# Charge explicitement backend/.env pour les intégrations lues via os.getenv
# (Meta, SMTP, Drive...). Sans cela, certaines clés restent invisibles selon
# le mode de lancement du backend.
load_dotenv(Path(__file__).with_name(".env"), override=True)
logger = logging.getLogger(__name__)

# ── Web Search (DuckDuckGo — sans clé API) ──────────────────────────────────
try:
    from duckduckgo_search import DDGS
    _DDG_AVAILABLE = True
except ImportError:
    _DDG_AVAILABLE = False


def run_web_search(query: str) -> str:
    """Recherche web (DuckDuckGo), gratuite — prospection, veille, listes publiques."""
    if not _DDG_AVAILABLE:
        return "DuckDuckGo non disponible. Installe duckduckgo-search."
    q = (query or "").strip()[:500]
    if not q:
        return "Requête vide."
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(q, max_results=5))
        if not results:
            return f"Aucun résultat pour : {q}"
        return "\n\n".join([
            f"**{r.get('title', '')}**\n{r.get('href', '')}\n{r.get('body', '')}"
            for r in results
        ])
    except Exception as e:
        return f"Erreur recherche : {e}"


@tool("Recherche web")
def web_search(query: str) -> str:
    """
    Effectue une recherche web via DuckDuckGo.
    Retourne les 5 premiers résultats avec titre, URL et extrait.
    Utilise cet outil pour trouver des prospects, actualités, concurrents,
    tendances marché, ou tout contenu web pertinent.
    """
    return run_web_search(query)


def run_read_webpage(url: str) -> str:
    """Extrait le texte d'une page http(s) — pour approfondir un résultat de recherche."""
    u = (url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        return "URL refusée : uniquement http:// ou https://"
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = httpx.get(u, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:3000]
    except Exception as e:
        return f"Impossible de lire {u} : {e}"


@tool("Lire une page web")
def read_webpage(url: str) -> str:
    """
    Lit le contenu textuel d'une page web à partir de son URL.
    Utilise cet outil pour lire un article, une fiche LinkedIn publique,
    une page d'entreprise, ou tout contenu web accessible.
    """
    return run_read_webpage(url)


# ── Instagram (Graph API Meta) ──────────────────────────────────────────────
_IG_TOKEN = os.getenv("INSTAGRAM_ACCESS_TOKEN", "")
_IG_ACCOUNT_ID = os.getenv("INSTAGRAM_ACCOUNT_ID", "")


def run_post_instagram(caption: str, image_url: str = "") -> str:
    if not _IG_TOKEN or not _IG_ACCOUNT_ID:
        return (
            "[SIMULATION] Post Instagram prêt à publier :\n"
            f"Caption : {caption}\n"
            "⚠️ Configure INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env pour publier réellement."
        )
    try:
        payload = {"caption": caption, "access_token": _IG_TOKEN}
        if image_url:
            payload["image_url"] = image_url
        else:
            payload["media_type"] = "REELS"
        r = httpx.post(
            f"https://graph.facebook.com/v18.0/{_IG_ACCOUNT_ID}/media",
            data=payload, timeout=15
        )
        r.raise_for_status()
        container_id = r.json().get("id")
        r2 = httpx.post(
            f"https://graph.facebook.com/v18.0/{_IG_ACCOUNT_ID}/media_publish",
            data={"creation_id": container_id, "access_token": _IG_TOKEN},
            timeout=15
        )
        r2.raise_for_status()
        return f"✅ Post Instagram publié (id: {r2.json().get('id')})"
    except Exception as e:
        return f"Erreur Instagram : {e}"


@tool("Publier sur Instagram")
def post_instagram(caption: str, image_url: str = "") -> str:
    """
    Publie un post sur le compte Instagram d'Élude In Art.
    caption : texte du post (avec hashtags).
    image_url : URL publique de l'image (optionnel pour test).
    Nécessite INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env
    """
    return run_post_instagram(caption, image_url)


# ── Facebook (Graph API Meta) ───────────────────────────────────────────────
_FB_TOKEN = os.getenv("FACEBOOK_ACCESS_TOKEN", "")
_FB_PAGE_ID = os.getenv("FACEBOOK_PAGE_ID", "")


def run_post_facebook(message: str) -> str:
    if not _FB_TOKEN or not _FB_PAGE_ID:
        return (
            "[SIMULATION] Post Facebook prêt :\n"
            f"{message}\n"
            "⚠️ Configure FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env pour publier réellement."
        )
    try:
        r = httpx.post(
            f"https://graph.facebook.com/v18.0/{_FB_PAGE_ID}/feed",
            data={"message": message, "access_token": _FB_TOKEN},
            timeout=15
        )
        r.raise_for_status()
        return f"✅ Post Facebook publié (id: {r.json().get('id')})"
    except Exception as e:
        return f"Erreur Facebook : {e}"


@tool("Publier sur Facebook")
def post_facebook(message: str) -> str:
    """
    Publie un post sur la page Facebook d'Élude In Art.
    Nécessite FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env
    """
    return run_post_facebook(message)


def run_search_linkedin(query: str) -> str:
    """Recherche orientée profils / pages LinkedIn publiques (via moteur de recherche)."""
    return run_web_search(f"site:linkedin.com {(query or '').strip()[:400]}")


@tool("Rechercher sur LinkedIn")
def search_linkedin(query: str) -> str:
    """
    Recherche des profils ou entreprises sur LinkedIn via DuckDuckGo
    (site:linkedin.com). Retourne des profils publics pertinents.
    Pour poster sur LinkedIn, configure LINKEDIN_ACCESS_TOKEN dans .env
    """
    return run_search_linkedin(query)


# ── Email (simulation / SMTP) ───────────────────────────────────────────────
_SMTP_HOST = os.getenv("SMTP_HOST", "")
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASS = os.getenv("SMTP_PASS", "")


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
    Envoie un email. Utilise cet outil pour la prospection,
    les suivis clients, ou toute communication par email.
    Nécessite SMTP_HOST, SMTP_USER, SMTP_PASS dans .env
    """
    return run_send_email(to, subject, body)


# ── Google Drive (upload fichier texte) ─────────────────────────────────────
# Priorité : token spécifique Drive, sinon token Google multi-scope.
_GDRIVE_TOKEN = (os.getenv("GOOGLE_DRIVE_ACCESS_TOKEN", "") or os.getenv("GOOGLE_API_ACCESS_TOKEN", "")).strip()
_GDRIVE_FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "")
_GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "").strip()
_GOOGLE_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
_GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
_GOOGLE_TOKEN_ENDPOINT = os.getenv("GOOGLE_OAUTH_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token").strip()
_GOOGLE_TOKEN_CACHE: dict[str, float | str] = {"access_token": "", "expires_at": 0.0}


def _refresh_google_access_token(force: bool = False) -> str:
    """Renouvelle le token OAuth Google via refresh_token (si configuré)."""
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
    # 1) token direct depuis .env ; 2) token cache/refreshed.
    if _GDRIVE_TOKEN:
        return _GDRIVE_TOKEN
    refreshed = _refresh_google_access_token(force=False)
    return refreshed or ""


def run_upload_google_drive(
    filename: str,
    content: str,
    mime_type: str = "text/plain",
    folder_id: str = "",
) -> str:
    """Crée un fichier Google Drive depuis un texte brut."""
    fn = (filename or "").strip()[:220]
    if not fn:
        return "Nom de fichier vide."
    token = _get_google_drive_token()
    if not token:
        return (
            "[SIMULATION] Fichier Drive prêt :\n"
            f"Nom : {fn}\n"
            f"MIME : {(mime_type or 'text/plain').strip() or 'text/plain'}\n"
            f"Taille contenu : {len(content or '')} caractères\n"
            "⚠️ Configure GOOGLE_API_ACCESS_TOKEN/GOOGLE_DRIVE_ACCESS_TOKEN "
            "ou le trio GOOGLE_OAUTH_REFRESH_TOKEN + GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET "
            "et optionnellement GOOGLE_DRIVE_FOLDER_ID "
            "dans .env pour créer réellement le fichier."
        )
    effective_folder = (folder_id or _GDRIVE_FOLDER_ID or "").strip()
    parent_json = f', "parents": ["{effective_folder}"]' if effective_folder else ""
    safe_mime = (mime_type or "text/plain").strip() or "text/plain"
    boundary = "korymb_drive_upload_boundary"
    metadata = f'{{"name":"{fn}"{parent_json}}}'
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {safe_mime}; charset=UTF-8\r\n\r\n"
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
        fid = data.get("id") or "?"
        name = data.get("name") or fn
        link = data.get("webViewLink")
        if link:
            return f"✅ Fichier Drive créé : {name} (id: {fid})\n{link}"
        return f"✅ Fichier Drive créé : {name} (id: {fid})"
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
    Crée un fichier sur Google Drive (texte ou markdown).
    Nécessite GOOGLE_API_ACCESS_TOKEN (ou GOOGLE_DRIVE_ACCESS_TOKEN) dans .env.
    Alternative durable : GOOGLE_OAUTH_REFRESH_TOKEN + GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET.
    Optionnel : GOOGLE_DRIVE_FOLDER_ID pour le dossier cible par défaut.
    """
    return run_upload_google_drive(filename, content, mime_type, folder_id)
