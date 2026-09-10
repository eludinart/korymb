"""Chaîne de moteurs média (image, audio, vidéo) — gratuit puis payant.

Un outil par type (`generate_image`, `text_to_speech`, `generate_video`).
Derrière : liste ordonnée lue dans la config runtime, comme Tavily → Brave → DuckDuckGo.

Les modèles ne sont jamais figés dans la logique métier : uniquement des défauts
overridables via Intégrations / .env.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import time
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from integration_settings import getenv

logger = logging.getLogger(__name__)

_mode_override: ContextVar[str] = ContextVar("korymb_media_engine_mode", default="")
_status_cache: dict[str, Any] = {"t": 0.0, "payload": None}

MODE_ECONOMY = "economy"
MODE_QUALITY = "quality"

IMAGE_ENGINES = ("mistral", "pollinations", "huggingface", "openrouter")
TTS_ENGINES = ("edge", "pollinations", "openai", "elevenlabs")
VIDEO_ENGINES = ("huggingface", "replicate", "fal", "runway", "storyboard")

_DEFAULT_CHAINS: dict[str, dict[str, tuple[str, ...]]] = {
    "image": {
        MODE_ECONOMY: ("mistral", "pollinations", "huggingface", "openrouter"),
        MODE_QUALITY: ("mistral", "openrouter", "huggingface", "pollinations"),
    },
    "tts": {
        MODE_ECONOMY: ("edge", "pollinations", "openai", "elevenlabs"),
        MODE_QUALITY: ("elevenlabs", "openai", "edge", "pollinations"),
    },
    "video": {
        MODE_ECONOMY: ("huggingface", "replicate", "fal", "runway", "storyboard"),
        MODE_QUALITY: ("replicate", "fal", "runway", "huggingface", "storyboard"),
    },
}


def push_media_engine_mode(mode: str) -> Token:
    _status_cache["t"] = 0.0
    _status_cache["payload"] = None
    return _mode_override.set(normalize_mode(mode) if (mode or "").strip() else "")


def reset_media_engine_mode(token: Token) -> None:
    _mode_override.reset(token)


def normalize_mode(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value in ("quality", "publication", "paid", "qualite", "qualité"):
        return MODE_QUALITY
    return MODE_ECONOMY


def current_mode() -> str:
    override = (_mode_override.get() or "").strip().lower()
    if override in (MODE_ECONOMY, MODE_QUALITY):
        return override
    return normalize_mode(getenv("MEDIA_ENGINE_MODE", MODE_ECONOMY))


def _flag_on(name: str, default: str = "1") -> bool:
    raw = (getenv(name, default) or default).strip().lower()
    return raw not in ("0", "false", "off", "no", "non")


def _parse_chain(raw: str, allowed: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    for part in (raw or "").replace(";", ",").split(","):
        name = part.strip().lower()
        if name in allowed and name not in out:
            out.append(name)
    return out


def _prefer(first: str, chain: list[str]) -> list[str]:
    name = (first or "").strip().lower()
    if not name or name not in chain:
        if name and name not in chain:
            return [name] + chain
        return chain
    return [name] + [item for item in chain if item != name]


def resolve_chain(kind: str) -> list[str]:
    kind = (kind or "").strip().lower()
    allowed = {"image": IMAGE_ENGINES, "tts": TTS_ENGINES, "video": VIDEO_ENGINES}[kind]
    env_key = {"image": "IMAGE_ENGINE_CHAIN", "tts": "TTS_ENGINE_CHAIN", "video": "VIDEO_ENGINE_CHAIN"}[kind]
    explicit = _parse_chain(getenv(env_key, ""), allowed)
    mode = current_mode()
    chain = explicit or list(_DEFAULT_CHAINS[kind].get(mode) or allowed)
    if kind == "image":
        return chain
    if kind == "tts":
        return _prefer(getenv("TTS_PROVIDER", ""), chain)
    return _prefer(getenv("VIDEO_GEN_PROVIDER", ""), chain)


def _hf_token() -> str:
    return (getenv("HUGGINGFACE_API_TOKEN", "") or getenv("HF_TOKEN", "")).strip()


def _pollinations_key() -> str:
    return getenv("POLLINATIONS_API_KEY", "").strip()


def _image_paid_ready() -> bool:
    return bool(
        (getenv("IMAGE_GEN_API_KEY", "") or getenv("OPENROUTER_API_KEY", "")).strip()
        and getenv("IMAGE_GEN_MODEL", "").strip()
    )


def _mistral_creds() -> tuple[str, str, str]:
    key = getenv("MISTRAL_API_KEY", "").strip()
    base = (getenv("MISTRAL_BASE_URL", "") or "https://api.mistral.ai/v1").strip().rstrip("/")
    model = (
        getenv("MISTRAL_IMAGE_MODEL", "").strip()
        or getenv("MISTRAL_MODEL", "").strip()
        or "mistral-medium-latest"
    )
    return key, base, model


def _mistral_ready() -> bool:
    return bool(_mistral_creds()[0])


def _tts_openai_ready() -> bool:
    return bool((getenv("TTS_API_KEY", "") or getenv("OPENAI_API_KEY", "")).strip())


def _tts_eleven_ready() -> bool:
    return bool(getenv("ELEVENLABS_API_KEY", "").strip())


def _edge_ready() -> bool:
    if not _flag_on("TTS_FREE_ENGINE", "1"):
        return False
    return importlib.util.find_spec("edge_tts") is not None


def engine_ready(kind: str, engine: str) -> bool:
    name = (engine or "").strip().lower()
    if kind == "image":
        if name == "mistral":
            return _mistral_ready()
        if name == "pollinations":
            return _flag_on("IMAGE_FREE_ENGINE", "1")
        if name == "huggingface":
            return bool(_hf_token()) and bool(getenv("IMAGE_HF_MODEL", "").strip())
        if name == "openrouter":
            return _image_paid_ready()
    if kind == "tts":
        if name == "edge":
            return _edge_ready()
        if name == "pollinations":
            return _flag_on("TTS_FREE_ENGINE", "1")
        if name == "openai":
            return _tts_openai_ready()
        if name == "elevenlabs":
            return _tts_eleven_ready()
    if kind == "video":
        if name == "storyboard":
            return _mistral_ready() or _flag_on("IMAGE_FREE_ENGINE", "1")
        if name == "huggingface":
            return bool(_hf_token()) and bool(getenv("VIDEO_HF_MODEL", "").strip())
        if name == "replicate":
            return bool((getenv("REPLICATE_API_TOKEN", "") or getenv("VIDEO_GEN_API_KEY", "")).strip())
        if name == "fal":
            return bool((getenv("FAL_KEY", "") or getenv("VIDEO_GEN_API_KEY", "")).strip())
        if name == "runway":
            return bool((getenv("RUNWAY_API_KEY", "") or getenv("VIDEO_GEN_API_KEY", "")).strip())
    return False


def catalog_status() -> dict[str, Any]:
    now = time.monotonic()
    mode = current_mode()
    cached = _status_cache.get("payload")
    if (
        isinstance(cached, dict)
        and cached.get("mode") == mode
        and (now - float(_status_cache.get("t") or 0)) < 2.0
    ):
        return cached
    kinds = ("image", "tts", "video")
    engines: dict[str, list[dict[str, Any]]] = {}
    for kind in kinds:
        rows = []
        for engine in resolve_chain(kind):
            rows.append(
                {
                    "id": engine,
                    "ready": engine_ready(kind, engine),
                    "free": engine in {"pollinations", "edge", "storyboard", "huggingface"},
                    "uses_llm_key": engine == "mistral",
                }
            )
        engines[kind] = rows
    payload = {
        "mode": mode,
        "modes": [
            {
                "id": MODE_ECONOMY,
                "label": "Économique",
                "hint": "Clé Mistral (déjà branchée pour le chat), puis moteurs gratuits en repli.",
            },
            {
                "id": MODE_QUALITY,
                "label": "Qualité publication",
                "hint": "Moteurs payants d’abord s’ils sont branchés, sinon gratuit.",
            },
        ],
        "engines": engines,
        "ready": {
            "image": any(bool(r.get("ready")) for r in engines.get("image") or []),
            "tts": any(bool(r.get("ready")) for r in engines.get("tts") or []),
            "video": any(bool(r.get("ready")) for r in engines.get("video") or []),
            "pdf": True,
        },
    }
    _status_cache["t"] = now
    _status_cache["payload"] = payload
    return payload


def _save_bytes(data: bytes, filename: str, mime: str) -> str:
    if not data or len(data) < 80:
        return ""
    from services.resource_files import save_upload

    saved = save_upload(filename=filename, mime=mime, data=data)
    if saved.get("success"):
        meta = saved["file"]
        return f"file_id: {meta['id']} ({meta['size']} octets)"
    return ""


def _download_url(url: str, filename: str, mime: str) -> str:
    try:
        r = httpx.get(url, timeout=90, follow_redirects=True)
        r.raise_for_status()
        return _save_bytes(r.content, filename, mime)
    except Exception:
        logger.exception("media download")
        return ""


def _parse_size(size: str, default: tuple[int, int] = (1024, 1024)) -> tuple[int, int]:
    raw = (size or "").lower().replace(" ", "")
    if "x" not in raw:
        return default
    try:
        w, h = raw.split("x", 1)
        return max(256, min(int(w), 2048)), max(256, min(int(h), 2048))
    except ValueError:
        return default


def _looks_like_image(content: bytes, content_type: str) -> bool:
    if not content or len(content) < 80:
        return False
    ctype = (content_type or "").lower()
    if "image/" in ctype or "octet-stream" in ctype:
        return True
    return content[:8].startswith(b"\x89PNG") or content[:3] == b"\xff\xd8\xff" or content[:4] == b"RIFF"


def _looks_like_audio(content: bytes, content_type: str) -> bool:
    if not content or len(content) < 80:
        return False
    ctype = (content_type or "").lower()
    if "audio/" in ctype or "octet-stream" in ctype or "mpeg" in ctype:
        return True
    return content[:3] == b"ID3" or content[:2] == b"\xff\xfb" or content[:4] == b"RIFF"


def _write_tts_file(data: bytes) -> str:
    out = getenv("TTS_OUTPUT_DIR", "data/tts").strip() or "data/tts"
    Path(out).mkdir(parents=True, exist_ok=True)
    fpath = Path(out) / f"tts_{int(time.time())}.mp3"
    fpath.write_bytes(data)
    saved = _save_bytes(data, fpath.name, "audio/mpeg")
    line = f"✅ Audio généré : {fpath}"
    if saved:
        line += f"\n{saved}"
    return line


# ── Image ────────────────────────────────────────────────────────────────────


def generate_image(prompt: str, size: str = "1024x1024") -> str:
    p = (prompt or "").strip()[:2000]
    if not p:
        return "Prompt vide."
    errors: list[str] = []
    runners = {
        "mistral": _image_mistral,
        "pollinations": _image_pollinations,
        "huggingface": _image_huggingface,
        "openrouter": _image_openrouter,
    }
    for engine in resolve_chain("image"):
        if not engine_ready("image", engine):
            continue
        fn = runners.get(engine)
        if not fn:
            continue
        try:
            result = fn(p, size)
        except Exception as exc:
            errors.append(f"{engine}: {exc}")
            logger.warning("image engine %s failed: %s", engine, exc)
            continue
        if result:
            return result
        errors.append(f"{engine}: vide")
    detail = f"Prompt : {p}"
    if errors:
        detail += "\nTentatives : " + " · ".join(errors[:6])
    return (
        "[SIMULATION] Image à générer :\n"
        f"{detail}\n"
        "Mistral (clé LLM) et Pollinations indisponibles — aucune image générée."
    )


def _mistral_file_ids(payload: Any) -> list[str]:
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            typ = str(node.get("type") or "").lower().replace("-", "_")
            fid = str(node.get("file_id") or node.get("fileId") or "").strip()
            if fid and (
                typ in {"tool_file", "file", "image"}
                or node.get("file_type")
                or node.get("file_name")
            ):
                found.append(fid)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    out: list[str] = []
    for fid in found:
        if fid not in out:
            out.append(fid)
    return out


_MISTRAL_AGENT_ID = ""


def _image_mistral(prompt: str, size: str) -> str | None:
    key, base, model = _mistral_creds()
    if not key:
        return None
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    prompt_full = (
        f"Génère une seule image via l'outil image_generation. "
        f"Format {size or '1024x1024'}. {prompt}"
    )
    data = _mistral_start_conversation(headers, base, model, prompt_full)
    file_ids = _mistral_file_ids(data)
    if not file_ids:
        raise RuntimeError("Mistral n’a renvoyé aucun fichier image.")
    raw = _mistral_download_file(headers, base, file_ids[0])
    if not raw or not _looks_like_image(raw, "image/png"):
        raise RuntimeError("Téléchargement image Mistral vide.")
    saved = _save_bytes(raw, "image.png", "image/png")
    extra = f"\n{saved}" if saved else f" ({len(raw)} octets)"
    return f"✅ Image générée (mistral / flux){extra}\nPrompt : {prompt}"


def _mistral_start_conversation(headers: dict[str, str], base: str, model: str, prompt_full: str) -> dict[str, Any]:
    attempts = [
        {"model": model, "tools": [{"type": "image_generation"}], "inputs": prompt_full},
        {
            "model": model,
            "tools": [{"type": "image_generation"}],
            "inputs": [{"role": "user", "content": prompt_full}],
        },
    ]
    last: httpx.Response | None = None
    for body in attempts:
        last = httpx.post(f"{base}/conversations", headers=headers, json=body, timeout=120)
        if last.is_success:
            payload = last.json()
            if isinstance(payload, dict):
                return payload
            raise RuntimeError("Réponse Mistral inattendue.")
        if last.status_code not in (400, 404, 422):
            break
    agent_id = _mistral_ensure_image_agent(headers, base, model)
    last = httpx.post(
        f"{base}/conversations",
        headers=headers,
        json={"agent_id": agent_id, "inputs": prompt_full},
        timeout=120,
    )
    if not last.is_success:
        err = ""
        try:
            blob = last.json()
            err = str(blob.get("message") or blob.get("detail") or blob.get("error") or "")
        except Exception:
            err = (last.text or "")[:240]
        raise RuntimeError(err or f"HTTP {last.status_code}")
    payload = last.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Réponse Mistral inattendue.")
    return payload


def _mistral_ensure_image_agent(headers: dict[str, str], base: str, model: str) -> str:
    global _MISTRAL_AGENT_ID
    configured = getenv("MISTRAL_IMAGE_AGENT_ID", "").strip()
    if configured:
        return configured
    if _MISTRAL_AGENT_ID:
        return _MISTRAL_AGENT_ID
    r = httpx.post(
        f"{base}/agents",
        headers=headers,
        json={
            "model": model,
            "name": "Korymb image",
            "description": "Génération d'images Studio",
            "instructions": "Use the image generation tool when you have to create images.",
            "tools": [{"type": "image_generation"}],
        },
        timeout=30,
    )
    r.raise_for_status()
    aid = str((r.json() or {}).get("id") or "")
    if not aid:
        raise RuntimeError("Création agent image Mistral impossible.")
    _MISTRAL_AGENT_ID = aid
    return aid


def _mistral_download_file(headers: dict[str, str], base: str, file_id: str) -> bytes:
    auth = {k: v for k, v in headers.items() if k.lower() == "authorization"}
    for path in (f"{base}/files/{file_id}/content", f"{base}/files/{file_id}"):
        r = httpx.get(path, headers=auth, timeout=60, follow_redirects=True)
        if not r.is_success:
            continue
        ctype = r.headers.get("content-type", "")
        if "application/json" in ctype and not _looks_like_image(r.content, ctype):
            continue
        if _looks_like_image(r.content, ctype) or len(r.content) > 80:
            return r.content
    return b""


def _image_pollinations(prompt: str, size: str) -> str | None:
    width, height = _parse_size(size)
    model = getenv("POLLINATIONS_IMAGE_MODEL", "").strip() or getenv("IMAGE_FREE_MODEL", "").strip()
    base = (getenv("IMAGE_FREE_BASE_URL", "") or "https://image.pollinations.ai/prompt").rstrip("/")
    qs = f"width={width}&height={height}&nologo=true"
    if model:
        qs += f"&model={quote(model, safe='')}"
    url = f"{base}/{quote(prompt, safe='')}?{qs}"
    headers = {}
    key = _pollinations_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.get(url, headers=headers or None, timeout=90, follow_redirects=True)
    r.raise_for_status()
    if not _looks_like_image(r.content, r.headers.get("content-type", "")):
        return None
    saved = _save_bytes(r.content, "image.png", r.headers.get("content-type", "image/png").split(";")[0])
    if saved:
        return f"✅ Image générée (pollinations)\n{saved}\nPrompt : {prompt}"
    return f"✅ Image générée (pollinations) : {url}\nPrompt : {prompt}"


def _image_huggingface(prompt: str, size: str) -> str | None:
    token = _hf_token()
    model = getenv("IMAGE_HF_MODEL", "").strip()
    if not token or not model:
        return None
    width, height = _parse_size(size)
    r = httpx.post(
        f"https://api-inference.huggingface.co/models/{model.lstrip('/')}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"inputs": prompt, "parameters": {"width": width, "height": height}},
        timeout=90,
    )
    r.raise_for_status()
    ctype = r.headers.get("content-type", "")
    data = r.content
    if "application/json" in ctype:
        payload = r.json()
        err = payload.get("error") if isinstance(payload, dict) else None
        if err:
            raise RuntimeError(str(err)[:240])
        return None
    if not _looks_like_image(data, ctype):
        return None
    mime = ctype.split(";")[0] if ctype.startswith("image/") else "image/png"
    saved = _save_bytes(data, "image.png", mime)
    if saved:
        return f"✅ Image générée (huggingface / {model})\n{saved}\nPrompt : {prompt}"
    return f"✅ Image Hugging Face ({model}) — {len(data)} octets.\nPrompt : {prompt}"


def _image_openrouter(prompt: str, size: str) -> str | None:
    if not _image_paid_ready():
        return None
    base = (getenv("IMAGE_GEN_BASE_URL") or getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
    img_key = getenv("IMAGE_GEN_API_KEY") or getenv("OPENROUTER_API_KEY")
    model = getenv("IMAGE_GEN_MODEL", "").strip()
    headers = {
        "Authorization": f"Bearer {img_key}",
        "Content-Type": "application/json",
    }
    referer = getenv("OPENROUTER_HTTP_REFERER")
    title = getenv("OPENROUTER_APP_TITLE") or "Korymb"
    if referer:
        headers["HTTP-Referer"] = referer
    if title:
        headers["X-Title"] = title
    resp = httpx.post(
        f"{base}/images/generations",
        headers=headers,
        json={"model": model, "prompt": prompt, "n": 1, "size": (size or "1024x1024").strip()},
        timeout=90,
    )
    resp.raise_for_status()
    data = resp.json()
    items = data.get("data") or []
    if not items:
        return None
    item = items[0]
    img_url = item.get("url") or ""
    b64 = item.get("b64_json") or ""
    if img_url:
        saved = _download_url(str(img_url), "image.png", "image/png")
        extra = f"\n{saved}" if saved else ""
        return f"✅ Image générée ({model}) :\n{img_url}{extra}\n\nPrompt : {prompt}"
    if b64:
        import base64

        raw = base64.b64decode(b64)
        saved = _save_bytes(raw, "image.png", "image/png")
        extra = f"\n{saved}" if saved else f" ({len(b64)} caractères base64)"
        return f"✅ Image générée ({model}){extra}.\nPrompt : {prompt}"
    return None


# ── Audio ────────────────────────────────────────────────────────────────────


def synthesize_speech(text: str, voice: str = "") -> str:
    content = (text or "").strip()
    if not content:
        return "text requis."
    errors: list[str] = []
    runners = {
        "edge": _tts_edge,
        "pollinations": _tts_pollinations,
        "openai": _tts_openai,
        "elevenlabs": _tts_elevenlabs,
    }
    for engine in resolve_chain("tts"):
        if not engine_ready("tts", engine):
            continue
        fn = runners.get(engine)
        if not fn:
            continue
        try:
            result = fn(content, voice)
        except Exception as exc:
            errors.append(f"{engine}: {exc}")
            logger.warning("tts engine %s failed: %s", engine, exc)
            continue
        if result:
            return result
        errors.append(f"{engine}: vide")
    detail = content[:300]
    if errors:
        detail += "\nTentatives : " + " · ".join(errors[:6])
    return (
        "[SIMULATION] TTS :\n"
        f"{detail}\n"
        "⚠️ Branchez ElevenLabs / OpenAI, ou installez edge-tts pour une voix gratuite."
    )


def _edge_voice(requested: str) -> str:
    dedicated = getenv("EDGE_TTS_VOICE", "").strip()
    if dedicated:
        return dedicated
    raw = (requested or getenv("TTS_VOICE", "")).strip()
    if "Neural" in raw or (raw.count("-") >= 2 and not raw.lower() in {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}):
        return raw
    return "fr-FR-DeniseNeural"


def _run_coro(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result(timeout=90)


def _tts_edge(text: str, voice: str) -> str | None:
    try:
        import edge_tts
    except ImportError:
        return None
    vid = _edge_voice(voice)

    async def _synth() -> bytes:
        communicate = edge_tts.Communicate(text[:5000], vid)
        chunks: list[bytes] = []
        async for message in communicate.stream():
            if message.get("type") == "audio":
                chunks.append(message["data"])
        return b"".join(chunks)

    data = _run_coro(_synth())
    if not data or len(data) < 80:
        return None
    out = _write_tts_file(data)
    return out.replace("✅ Audio généré", f"✅ Audio généré (edge / {vid})", 1)


def _tts_pollinations(text: str, voice: str) -> str | None:
    base = (getenv("TTS_FREE_BASE_URL", "") or "https://text.pollinations.ai").rstrip("/")
    vid = (voice or getenv("TTS_VOICE", "nova") or "nova").strip()
    headers = {"Accept": "audio/mpeg"}
    key = _pollinations_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.get(
        f"{base}/{quote(text[:800], safe='')}",
        params={"model": getenv("TTS_FREE_MODEL", "").strip() or "openai-audio", "voice": vid},
        headers=headers,
        timeout=60,
        follow_redirects=True,
    )
    r.raise_for_status()
    if not _looks_like_audio(r.content, r.headers.get("content-type", "")):
        return None
    out = _write_tts_file(r.content)
    return out.replace("✅ Audio généré", "✅ Audio généré (pollinations)", 1)


def _tts_openai(text: str, voice: str) -> str | None:
    key = (getenv("TTS_API_KEY", "") or getenv("OPENAI_API_KEY", "")).strip()
    if not key:
        return None
    base = (getenv("TTS_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
    model = getenv("TTS_MODEL", "").strip() or "tts-1"
    voice_id = (voice or getenv("TTS_VOICE", "alloy")).strip() or "alloy"
    r = httpx.post(
        f"{base}/audio/speech",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "voice": voice_id, "input": text[:4096]},
        timeout=60,
    )
    r.raise_for_status()
    if not _looks_like_audio(r.content, r.headers.get("content-type", "")):
        return None
    out = _write_tts_file(r.content)
    return out.replace("✅ Audio généré", f"✅ Audio généré ({model})", 1)


def _tts_elevenlabs(text: str, voice: str) -> str | None:
    key = getenv("ELEVENLABS_API_KEY", "").strip()
    if not key:
        return None
    vid = getenv("ELEVENLABS_VOICE_ID", "").strip() or (voice or "").strip()
    model = getenv("ELEVENLABS_MODEL", "").strip() or "eleven_multilingual_v2"
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{vid}",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        json={"text": text[:5000], "model_id": model},
        timeout=60,
    )
    r.raise_for_status()
    if not _looks_like_audio(r.content, r.headers.get("content-type", "")):
        return None
    out = _write_tts_file(r.content)
    return out.replace("✅ Audio généré", "✅ Audio généré (ElevenLabs)", 1)


# ── Vidéo ────────────────────────────────────────────────────────────────────


def generate_video(prompt: str, duration_seconds: int = 5, aspect_ratio: str = "9:16") -> str:
    p = (prompt or "").strip()[:1800]
    if not p:
        return "Prompt vidéo vide."
    dur = max(2, min(int(duration_seconds or 5), 12))
    ratio = (aspect_ratio or "9:16").strip() or "9:16"
    errors: list[str] = []
    runners = {
        "huggingface": lambda: _video_huggingface(p, dur, ratio),
        "replicate": lambda: _replicate_video(p, dur, ratio),
        "fal": lambda: _fal_video(p, dur, ratio),
        "runway": lambda: _runway_video(p, dur, ratio),
        "storyboard": lambda: _video_storyboard(p, dur, ratio),
    }
    for engine in resolve_chain("video"):
        if not engine_ready("video", engine):
            continue
        fn = runners.get(engine)
        if not fn:
            continue
        try:
            result = fn()
        except Exception as exc:
            errors.append(f"{engine}: {exc}")
            logger.warning("video engine %s failed: %s", engine, exc)
            continue
        if result and not result.startswith("[SIMULATION]"):
            return result
        if result:
            errors.append(f"{engine}: simulation")
    detail = f"Prompt : {p}\nDurée : {dur}s · {ratio}"
    if errors:
        detail += "\nTentatives : " + " · ".join(errors[:6])
    return (
        "[SIMULATION] Vidéo IA :\n"
        f"{detail}\n"
        "Storyboard visuel indisponible. Branchez Replicate / fal / Runway pour un clip, "
        "ou laissez IMAGE_FREE_ENGINE actif pour des images de plans."
    )


def _video_storyboard(prompt: str, duration: int, ratio: str) -> str | None:
    frames = 3
    saved_ids: list[str] = []
    for idx in range(frames):
        shot = f"{prompt}. Plan {idx + 1}/{frames}, cadrage {ratio}, lumière naturelle, pas de cliché voyance."
        try:
            if _mistral_ready():
                out = _image_mistral(shot, "768x1280" if ratio in ("9:16", "9/16") else "1280x768")
            else:
                out = None
        except Exception:
            out = None
        if not out:
            try:
                out = _image_pollinations(shot, "768x1280" if ratio in ("9:16", "9/16") else "1280x768")
            except Exception:
                out = None
        if out and "file_id:" in out:
            saved_ids.append(out.split("file_id:", 1)[1].split()[0])
    if not saved_ids:
        return None
    ids = ", ".join(saved_ids)
    return (
        f"✅ Storyboard visuel ({'mistral' if _mistral_ready() else 'gratuit'}, {len(saved_ids)} plans, {duration}s, {ratio})\n"
        f"file_id: {ids}\n"
        "Ce n’est pas un clip MP4 : branchez Replicate / fal / Runway pour la vidéo animée.\n"
        f"Prompt : {prompt}"
    )


def _video_huggingface(prompt: str, duration: int, ratio: str) -> str | None:
    token = _hf_token()
    model = getenv("VIDEO_HF_MODEL", "").strip()
    if not token or not model:
        return None
    r = httpx.post(
        f"https://api-inference.huggingface.co/models/{model.lstrip('/')}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"inputs": prompt, "parameters": {"num_frames": max(8, duration * 4)}},
        timeout=120,
    )
    r.raise_for_status()
    ctype = r.headers.get("content-type", "")
    if "application/json" in ctype:
        payload = r.json()
        err = payload.get("error") if isinstance(payload, dict) else None
        if err:
            raise RuntimeError(str(err)[:240])
        return None
    if len(r.content) < 400:
        return None
    mime = "video/mp4" if "video" in ctype or r.content[4:8] == b"ftyp" else "application/octet-stream"
    saved = _save_bytes(r.content, "video.mp4", mime if mime.startswith("video/") else "video/mp4")
    if saved:
        return f"✅ Vidéo Hugging Face ({model})\n{saved}"
    return None


def _replicate_video(prompt: str, duration: int, ratio: str) -> str | None:
    token = getenv("REPLICATE_API_TOKEN", "").strip() or getenv("VIDEO_GEN_API_KEY", "").strip()
    model = getenv("VIDEO_GEN_MODEL", "").strip() or "kwaivgi/kling-v2.1-standard"
    if not token:
        return None
    owner_name = model if "/" in model else f"kwaivgi/{model}"
    r = httpx.post(
        "https://api.replicate.com/v1/predictions",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "wait=60",
        },
        json={
            "model": owner_name,
            "input": {"prompt": prompt, "duration": duration, "aspect_ratio": ratio},
        },
        timeout=90,
    )
    r.raise_for_status()
    data = r.json()
    status = str(data.get("status") or "")
    pred_id = str(data.get("id") or "")
    if status in ("starting", "processing") and pred_id:
        data = _poll_replicate(token, pred_id)
        status = str(data.get("status") or "")
    output = data.get("output")
    url = ""
    if isinstance(output, str):
        url = output
    elif isinstance(output, list) and output:
        url = str(output[0])
    elif isinstance(output, dict):
        url = str(output.get("url") or output.get("video") or "")
    if url:
        saved = _download_url(url, "video.mp4", "video/mp4")
        extra = f"\n{saved}" if saved else ""
        return f"✅ Vidéo Replicate ({owner_name}){extra}\n{url}"
    err = data.get("error") or status or "sans URL"
    raise RuntimeError(str(err)[:240])


def _poll_replicate(token: str, pred_id: str, *, attempts: int = 12) -> dict[str, Any]:
    url = f"https://api.replicate.com/v1/predictions/{pred_id}"
    last: dict[str, Any] = {}
    for _ in range(attempts):
        time.sleep(5)
        r = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        r.raise_for_status()
        last = r.json()
        if str(last.get("status") or "") in ("succeeded", "failed", "canceled"):
            return last
    return last


def _fal_video(prompt: str, duration: int, ratio: str) -> str | None:
    key = getenv("FAL_KEY", "").strip() or getenv("VIDEO_GEN_API_KEY", "").strip()
    model = getenv("VIDEO_GEN_MODEL", "").strip() or "fal-ai/kling-video/v2.1/standard/text-to-video"
    if not key:
        return None
    r = httpx.post(
        f"https://fal.run/{model.lstrip('/')}",
        headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
        json={"prompt": prompt, "duration": str(duration), "aspect_ratio": ratio},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    video = data.get("video") if isinstance(data.get("video"), dict) else {}
    url = str(video.get("url") or data.get("url") or "")
    if url:
        saved = _download_url(url, "video.mp4", "video/mp4")
        extra = f"\n{saved}" if saved else ""
        return f"✅ Vidéo fal.ai ({model}){extra}\n{url}"
    raise RuntimeError(str(data)[:240])


def _runway_video(prompt: str, duration: int, ratio: str) -> str | None:
    key = getenv("RUNWAY_API_KEY", "").strip() or getenv("VIDEO_GEN_API_KEY", "").strip()
    model = getenv("VIDEO_GEN_MODEL", "").strip() or "gen4_turbo"
    if not key:
        return None
    r = httpx.post(
        "https://api.dev.runwayml.com/v1/text_to_video",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Runway-Version": "2024-11-06",
        },
        json={
            "model": model,
            "promptText": prompt,
            "duration": duration,
            "ratio": "720:1280" if ratio in ("9:16", "9/16") else "1280:720",
        },
        timeout=90,
    )
    r.raise_for_status()
    data = r.json()
    tid = str(data.get("id") or "")
    return (
        f"✅ Job Runway lancé ({model}) id={tid}. "
        "Récupérez le clip dans le dashboard Runway ou attendez le webhook."
    )
