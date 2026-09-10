"""Connexion OAuth chez le fournisseur (Google, LinkedIn) — récupère le jeton sans copier-coller."""
from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import quote, urlencode

import httpx
import jwt

from config import settings

logger = logging.getLogger(__name__)

GOOGLE_SCOPES = " ".join(
    [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/spreadsheets",
    ]
)

PROVIDERS: dict[str, dict[str, str]] = {
    "google": {
        "auth": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "client_id_key": "GOOGLE_OAUTH_CLIENT_ID",
        "client_secret_key": "GOOGLE_OAUTH_CLIENT_SECRET",
        "scopes": GOOGLE_SCOPES,
    },
    "linkedin": {
        "auth": "https://www.linkedin.com/oauth/v2/authorization",
        "token": "https://www.linkedin.com/oauth/v2/accessToken",
        "client_id_key": "LINKEDIN_CLIENT_ID",
        "client_secret_key": "LINKEDIN_CLIENT_SECRET",
        "scopes": "openid profile email w_member_social",
    },
}


def _jwt_secret() -> str:
    return (settings.jwt_secret or settings.agent_api_secret or "").strip()


def provider_ready(provider: str) -> bool:
    from integration_settings import getenv

    spec = PROVIDERS.get(provider or "")
    if not spec:
        return False
    return bool(getenv(spec["client_id_key"]) and getenv(spec["client_secret_key"]))


def sign_oauth_state(*, provider: str, redirect_uri: str) -> str:
    secret = _jwt_secret()
    if not secret:
        raise ValueError("Secret JWT manquant — impossible de démarrer OAuth.")
    return jwt.encode(
        {
            "p": provider,
            "r": redirect_uri,
            "exp": int(time.time()) + 600,
        },
        secret,
        algorithm="HS256",
    )


def read_oauth_state(state: str) -> dict[str, str]:
    secret = _jwt_secret()
    if not secret:
        raise ValueError("Secret JWT manquant.")
    data = jwt.decode(state, secret, algorithms=["HS256"])
    provider = str(data.get("p") or "")
    redirect_uri = str(data.get("r") or "")
    if provider not in PROVIDERS or not redirect_uri:
        raise ValueError("État OAuth invalide.")
    return {"provider": provider, "redirect_uri": redirect_uri}


def start_oauth(*, provider: str, redirect_uri: str) -> dict[str, Any]:
    from integration_settings import getenv

    spec = PROVIDERS.get(provider or "")
    if not spec:
        raise ValueError("Fournisseur OAuth inconnu (google ou linkedin).")
    redirect_uri = (redirect_uri or "").strip()
    if not redirect_uri.startswith("http"):
        raise ValueError("URI de redirection invalide.")
    client_id = getenv(spec["client_id_key"])
    if not client_id:
        raise ValueError(
            "Client ID manquant — créez l’app chez le fournisseur, collez Client ID et Secret, puis réessayez."
        )
    if not getenv(spec["client_secret_key"]):
        raise ValueError("Client Secret manquant — collez-le avant de connecter le compte.")
    state = sign_oauth_state(provider=provider, redirect_uri=redirect_uri)
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": spec["scopes"],
        "state": state,
    }
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
    # LinkedIn refuse souvent les espaces de scope encodés en « + » (quote_plus).
    query = urlencode(params, quote_via=quote) if provider == "linkedin" else urlencode(params)
    return {
        "authorize_url": f"{spec['auth']}?{query}",
        "redirect_uri": redirect_uri,
        "provider": provider,
    }


def finish_oauth(*, code: str, state: str) -> dict[str, Any]:
    from integration_settings import getenv, save_partial

    parsed = read_oauth_state(state)
    provider = parsed["provider"]
    redirect_uri = parsed["redirect_uri"]
    spec = PROVIDERS[provider]
    code = (code or "").strip()
    if not code:
        raise ValueError("Code OAuth manquant.")
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": getenv(spec["client_id_key"]),
        "client_secret": getenv(spec["client_secret_key"]),
    }
    with httpx.Client(timeout=25) as client:
        token_res = client.post(
            spec["token"],
            data=payload,
            headers={"Accept": "application/json"},
        )
    if token_res.status_code >= 400:
        logger.warning("oauth token %s HTTP %s %s", provider, token_res.status_code, token_res.text[:400])
        raise ValueError(f"Le fournisseur a refusé le jeton (HTTP {token_res.status_code}).")
    try:
        body = token_res.json()
    except Exception:
        body = {}
    if not isinstance(body, dict) or not body.get("access_token"):
        from urllib.parse import parse_qs

        parsed_form = {k: v[0] for k, v in parse_qs(token_res.text).items()}
        if parsed_form:
            body = parsed_form
    access = str(body.get("access_token") or "").strip()
    refresh = str(body.get("refresh_token") or "").strip()
    if not access:
        raise ValueError("Aucun access_token renvoyé par le fournisseur.")
    updates: dict[str, str] = {}
    if provider == "google":
        if refresh:
            updates["GOOGLE_OAUTH_REFRESH_TOKEN"] = refresh
        updates["GOOGLE_API_ACCESS_TOKEN"] = access
    elif provider == "linkedin":
        updates["LINKEDIN_ACCESS_TOKEN"] = access
        urn = _linkedin_author_urn(access)
        if urn:
            updates["LINKEDIN_AUTHOR_URN"] = urn
    save_partial(updates)
    return {"ok": True, "provider": provider, "saved": sorted(updates.keys())}


def _linkedin_author_urn(access_token: str) -> str:
    try:
        with httpx.Client(timeout=15) as client:
            res = client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if res.status_code >= 400:
            return ""
        sub = str(res.json().get("sub") or "").strip()
        if sub:
            return f"urn:li:person:{sub}"
    except Exception:
        logger.exception("linkedin userinfo")
    return ""
