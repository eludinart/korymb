"""
tools.py — Outils disponibles pour les agents Korymb.
"""
import os
import httpx
from crewai.tools import tool

# ── Web Search (DuckDuckGo — sans clé API) ──────────────────────────────────
try:
    from duckduckgo_search import DDGS
    _DDG_AVAILABLE = True
except ImportError:
    _DDG_AVAILABLE = False


@tool("Recherche web")
def web_search(query: str) -> str:
    """
    Effectue une recherche web via DuckDuckGo.
    Retourne les 5 premiers résultats avec titre, URL et extrait.
    Utilise cet outil pour trouver des prospects, actualités, concurrents,
    tendances marché, ou tout contenu web pertinent.
    """
    if not _DDG_AVAILABLE:
        return "DuckDuckGo non disponible. Installe duckduckgo-search."
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        if not results:
            return f"Aucun résultat pour : {query}"
        return "\n\n".join([
            f"**{r.get('title', '')}**\n{r.get('href', '')}\n{r.get('body', '')}"
            for r in results
        ])
    except Exception as e:
        return f"Erreur recherche : {e}"


# ── Lecture de page web ─────────────────────────────────────────────────────
@tool("Lire une page web")
def read_webpage(url: str) -> str:
    """
    Lit le contenu textuel d'une page web à partir de son URL.
    Utilise cet outil pour lire un article, une fiche LinkedIn publique,
    une page d'entreprise, ou tout contenu web accessible.
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        # Extraction texto simple (sans BeautifulSoup)
        import re
        text = resp.text
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:3000]
    except Exception as e:
        return f"Impossible de lire {url} : {e}"


# ── Instagram (Graph API Meta) ──────────────────────────────────────────────
_IG_TOKEN = os.getenv("INSTAGRAM_ACCESS_TOKEN", "")
_IG_ACCOUNT_ID = os.getenv("INSTAGRAM_ACCOUNT_ID", "")


@tool("Publier sur Instagram")
def post_instagram(caption: str, image_url: str = "") -> str:
    """
    Publie un post sur le compte Instagram d'Élude In Art.
    caption : texte du post (avec hashtags).
    image_url : URL publique de l'image (optionnel pour test).
    Nécessite INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env
    """
    if not _IG_TOKEN or not _IG_ACCOUNT_ID:
        return (
            "[SIMULATION] Post Instagram prêt à publier :\n"
            f"Caption : {caption}\n"
            "⚠️ Configure INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID dans .env pour publier réellement."
        )
    try:
        # Étape 1 : créer le container
        payload = {"caption": caption, "access_token": _IG_TOKEN}
        if image_url:
            payload["image_url"] = image_url
        else:
            payload["media_type"] = "REELS"  # ou TEXT si disponible

        r = httpx.post(
            f"https://graph.facebook.com/v18.0/{_IG_ACCOUNT_ID}/media",
            data=payload, timeout=15
        )
        r.raise_for_status()
        container_id = r.json().get("id")

        # Étape 2 : publier
        r2 = httpx.post(
            f"https://graph.facebook.com/v18.0/{_IG_ACCOUNT_ID}/media_publish",
            data={"creation_id": container_id, "access_token": _IG_TOKEN},
            timeout=15
        )
        r2.raise_for_status()
        return f"✅ Post Instagram publié (id: {r2.json().get('id')})"
    except Exception as e:
        return f"Erreur Instagram : {e}"


# ── Facebook (Graph API Meta) ───────────────────────────────────────────────
_FB_TOKEN = os.getenv("FACEBOOK_ACCESS_TOKEN", "")
_FB_PAGE_ID = os.getenv("FACEBOOK_PAGE_ID", "")


@tool("Publier sur Facebook")
def post_facebook(message: str) -> str:
    """
    Publie un post sur la page Facebook d'Élude In Art.
    Nécessite FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID dans .env
    """
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


# ── LinkedIn (recherche publique) ───────────────────────────────────────────
@tool("Rechercher sur LinkedIn")
def search_linkedin(query: str) -> str:
    """
    Recherche des profils ou entreprises sur LinkedIn via DuckDuckGo
    (site:linkedin.com). Retourne des profils publics pertinents.
    Pour poster sur LinkedIn, configure LINKEDIN_ACCESS_TOKEN dans .env
    """
    return web_search(f"site:linkedin.com {query}")


# ── Email (simulation / SMTP) ───────────────────────────────────────────────
_SMTP_HOST = os.getenv("SMTP_HOST", "")
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASS = os.getenv("SMTP_PASS", "")


@tool("Envoyer un email")
def send_email(to: str, subject: str, body: str) -> str:
    """
    Envoie un email. Utilise cet outil pour la prospection,
    les suivis clients, ou toute communication par email.
    Nécessite SMTP_HOST, SMTP_USER, SMTP_PASS dans .env
    """
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
