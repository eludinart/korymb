"""Garde-fou déterministe : une précision chiffrée ou identifiante doit être dans les données du tour.

Le modèle peut rédiger. Il ne peut pas introduire un e-mail, un téléphone, une URL,
un montant, un pourcentage ou une date absents du message du dirigeant, de l'historique
utilisateur, du bloc de faits ou du résultat d'outil de ce tour.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

PLACEHOLDER = "〔non vérifié〕"
ABSTAIN = (
    "Je n'ai pas cette information dans les données de ce tour. "
    "Je ne la complète pas avec une valeur estimée."
)
PARTIAL_NOTE = (
    "Certaines précisions (e-mail, téléphone, lien, montant ou date) ont été retirées : "
    "elles ne figurent pas dans les données de ce tour."
)

_LOOKUP_RE = re.compile(
    r"\b(e-?mails?|mails?|t[eé]l[eé]phones?|montants?|devis|factures?)\b",
    re.I,
)
_ALLOWLIST = "https://korymb.eludein.art\nhttps://api-korymb.eludein.art"

_EMAIL = re.compile(
    r"(?i)(?<![A-Z0-9._%+\-])([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})(?![A-Z0-9\-])"
)
_URL = re.compile(r"(?i)\b((?:https?://|www\.)[^\s<>()\[\]]+)")
_PHONE = re.compile(r"(?<!\d)(\+?\d[\d\s.\-]{8,}\d)(?!\d)")
_AMOUNT = re.compile(
    r"(?i)(?<!\w)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:€|eur|usd|\$)"
)
_AMOUNT_PREFIX = re.compile(
    r"(?i)(?:€|\$)\s*(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?"
)
_PERCENT = re.compile(r"(?<!\w)(\d+(?:[.,]\d+)?)\s*%")
_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DATE_FR = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b")
_TRAIL = ".,);]>"


@dataclass
class ClaimContext:
    intent: str = "chat"
    evidence: str = ""
    user_corpus: str = ""


@dataclass
class ClaimGuardResult:
    text: str
    status: str
    intent: str
    dropped: list[str] = field(default_factory=list)

    def payload(self) -> dict:
        return {
            "status": self.status,
            "intent": self.intent,
            "dropped_count": len(self.dropped),
        }


def _user_corpus(user_text: str, history: list | None) -> str:
    parts = [user_text or ""]
    for item in history or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "") != "user":
            continue
        parts.append(str(item.get("content") or ""))
    return "\n".join(p for p in parts if str(p).strip())


def claim_context(
    *,
    user_text: str = "",
    history: list | None = None,
    job_logs: list | None = None,
) -> ClaimContext:
    intent = "chat"
    grounding = ""
    try:
        from services.chat_intelligence import (
            INTENT_CRM,
            INTENT_PLATFORM,
            INTENT_STATUS,
            build_chat_grounding_block,
            classify_chat_intent,
        )

        intent = classify_chat_intent(user_text or "")
        if intent not in {INTENT_STATUS, INTENT_CRM, INTENT_PLATFORM} and _LOOKUP_RE.search(user_text or ""):
            intent = INTENT_CRM
        if intent in {INTENT_STATUS, INTENT_CRM, INTENT_PLATFORM}:
            grounding = build_chat_grounding_block(user_text or "", intent=intent) or ""
    except Exception:
        grounding = ""
    logs = "\n".join(str(x) for x in (job_logs or []) if str(x).strip())
    evidence = "\n".join(p for p in (_ALLOWLIST, grounding, logs) if p.strip())
    return ClaimContext(intent=intent, evidence=evidence, user_corpus=_user_corpus(user_text, history))


def _norm_email(raw: str) -> str:
    return raw.strip().strip(_TRAIL).lower()


def _norm_url(raw: str) -> str:
    u = raw.strip().strip(_TRAIL).lower()
    if u.startswith("www."):
        u = "https://" + u
    return u.rstrip("/")


def _phone_digits(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("33") and len(digits) == 11:
        digits = "0" + digits[2:]
    return digits


def _parse_number(raw: str) -> float | None:
    s = raw.replace("\u00a0", "").replace("\u202f", "").replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _compact_digits_blob(text: str) -> str:
    return re.sub(r"[ \u00a0\u202f]", "", text)


def _number_in_text(text: str, value: float) -> bool:
    blob = _compact_digits_blob(text)
    if abs(value - round(value)) < 1e-6:
        token = str(int(round(value)))
        return re.search(rf"(?<!\d){re.escape(token)}(?!\d)", blob) is not None
    plain = f"{value:.2f}".rstrip("0").rstrip(".")
    swapped = plain.replace(".", ",")
    return any(
        re.search(rf"(?<!\d){re.escape(tok)}(?!\d)", blob) is not None
        for tok in (plain, swapped, f"{value:.2f}")
    )


def _dates_in(text: str) -> set[str]:
    found: set[str] = set()
    for y, m, d in _DATE_ISO.findall(text):
        found.add(f"{y}-{m}-{d}")
    for d, m, y in _DATE_FR.findall(text):
        found.add(f"{int(y):04d}-{int(m):02d}-{int(d):02d}")
    return found


def _supported(kind: str, raw: str, corpus: str, dates: set[str]) -> bool:
    if kind == "email":
        return _norm_email(raw) in corpus.lower()
    if kind == "url":
        norm = _norm_url(raw)
        folded = corpus.lower().replace(" ", "")
        return norm in folded or norm.removeprefix("https://") in folded or norm.removeprefix("http://") in folded
    if kind == "phone":
        digits = _phone_digits(raw)
        if len(digits) < 10:
            return True
        blob = re.sub(r"\D", "", corpus)
        tail = digits[-9:]
        return digits in blob or ("0" + tail) in blob or tail in blob
    if kind == "amount":
        value = _parse_number(raw)
        return value is not None and _number_in_text(corpus, value)
    if kind == "percent":
        value = _parse_number(raw)
        if value is None:
            return False
        token = str(int(value)) if abs(value - round(value)) < 1e-6 else str(value)
        blob = _compact_digits_blob(corpus).replace(",", ".")
        return re.search(rf"(?<!\d){re.escape(token)}\s*%", blob) is not None or re.search(
            rf"(?<!\d){re.escape(token.replace('.', ','))}\s*%", _compact_digits_blob(corpus)
        ) is not None
    if kind == "date":
        return raw in dates
    return True


def _collect(text: str) -> list[tuple[int, int, str, str]]:
    """Spans (start, end, kind, comparable) without overlap. Earlier kinds win."""
    found: list[tuple[int, int, str, str, int]] = []
    rank = {"email": 0, "url": 1, "amount": 2, "percent": 3, "date": 4, "phone": 5}

    def add(start: int, end: int, kind: str, key: str) -> None:
        if end <= start:
            return
        found.append((start, end, kind, key, rank[kind]))

    for m in _EMAIL.finditer(text):
        add(m.start(1), m.end(1), "email", _norm_email(m.group(1)))
    for m in _URL.finditer(text):
        add(m.start(1), m.end(1), "url", _norm_url(m.group(1)))
    for rx in (_AMOUNT, _AMOUNT_PREFIX):
        for m in rx.finditer(text):
            add(m.start(0), m.end(0), "amount", m.group(1))
    for m in _PERCENT.finditer(text):
        add(m.start(0), m.end(0), "percent", m.group(1))
    for m in _DATE_ISO.finditer(text):
        y, mo, d = m.group(1), m.group(2), m.group(3)
        add(m.start(0), m.end(0), "date", f"{y}-{mo}-{d}")
    for m in _DATE_FR.finditer(text):
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        add(m.start(0), m.end(0), "date", f"{y:04d}-{mo:02d}-{d:02d}")
    for m in _PHONE.finditer(text):
        raw = m.group(1)
        digits = _phone_digits(raw)
        if not (10 <= len(digits) <= 15):
            continue
        if not (raw.strip().startswith("+") or raw.strip().startswith("0") or re.search(r"[\s.]", raw)):
            continue
        add(m.start(1), m.end(1), "phone", digits)

    found.sort(key=lambda item: (item[0], item[4], -(item[1] - item[0])))
    kept: list[tuple[int, int, str, str]] = []
    cursor = -1
    for start, end, kind, key, _rank in found:
        if start < cursor:
            continue
        kept.append((start, end, kind, key))
        cursor = end
    return kept


def guard_unverified_claims(text: str, ctx: ClaimContext) -> ClaimGuardResult:
    raw = (text or "").strip()
    if not raw:
        return ClaimGuardResult(text="", status="anchored", intent=ctx.intent)
    corpus = "\n".join(p for p in (ctx.evidence, ctx.user_corpus, _ALLOWLIST) if p)
    dates = _dates_in(corpus)
    spans = _collect(raw)
    dropped: list[str] = []
    pieces: list[str] = []
    cursor = 0
    for start, end, kind, key in spans:
        if _supported(kind, key, corpus, dates):
            continue
        pieces.append(raw[cursor:start])
        pieces.append(PLACEHOLDER)
        dropped.append(kind)
        cursor = end
    pieces.append(raw[cursor:])
    cleaned = "".join(pieces)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if not dropped:
        return ClaimGuardResult(text=cleaned, status="anchored", intent=ctx.intent)
    remainder = cleaned.replace(PLACEHOLDER, "").strip()
    remainder = re.sub(r"\s+", " ", remainder)
    if len(remainder) < 48:
        return ClaimGuardResult(text=ABSTAIN, status="unknown", intent=ctx.intent, dropped=dropped)
    if PARTIAL_NOTE not in cleaned:
        cleaned = f"{cleaned}\n\n{PARTIAL_NOTE}"
    return ClaimGuardResult(text=cleaned, status="partial", intent=ctx.intent, dropped=dropped)


def apply_chat_claim_guard(
    text: str,
    *,
    user_text: str = "",
    history: list | None = None,
    job_logs: list | None = None,
) -> ClaimGuardResult:
    return guard_unverified_claims(
        text,
        claim_context(user_text=user_text, history=history, job_logs=job_logs),
    )


def seal_chat_texts(
    result: str,
    surface: str,
    *,
    user_text: str = "",
    history: list | None = None,
    job_logs: list | None = None,
    job_id: str | None = None,
) -> tuple[str, str, ClaimGuardResult]:
    """Nettoie le texte stocké et le texte affiché. Le statut publié est celui du texte affiché."""
    ctx = claim_context(user_text=user_text, history=history, job_logs=job_logs)
    stored = guard_unverified_claims(result, ctx)
    visible = guard_unverified_claims(surface, ctx)
    publish_claim_guard(job_id, visible)
    if job_logs is not None and visible.dropped:
        job_logs.append(
            f"[korymb] Garde-fou : {len(visible.dropped)} précision(s) retirée(s) ({visible.status})."
        )
    return stored.text, visible.text, visible


def publish_claim_guard(job_id: str | None, result: ClaimGuardResult) -> None:
    if not job_id:
        return
    payload = result.payload()
    try:
        from state import active_jobs, emit_job_event

        if job_id in active_jobs:
            active_jobs[job_id]["claim_guard"] = payload
        emit_job_event(job_id, "claim_guard", "coordinateur", payload)
    except Exception:
        return
