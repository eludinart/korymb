"""Les précisions chiffrées ou identifiantes doivent être dans les données du tour."""
from services.claim_guard import (
    ABSTAIN,
    PARTIAL_NOTE,
    PLACEHOLDER,
    ClaimContext,
    claim_context,
    guard_unverified_claims,
)


def _ctx(**kwargs) -> ClaimContext:
    base = {"intent": "crm", "evidence": "", "user_corpus": ""}
    base.update(kwargs)
    return ClaimContext(**base)


def test_invented_email_is_removed():
    out = guard_unverified_claims("Son e-mail est fake@example.com.", _ctx())
    assert "fake@example.com" not in out.text
    assert out.status == "unknown"
    assert out.text == ABSTAIN


def test_email_from_evidence_is_kept():
    out = guard_unverified_claims(
        "Son e-mail est martin@cabinet.fr.",
        _ctx(evidence='{"email": "martin@cabinet.fr"}'),
    )
    assert "martin@cabinet.fr" in out.text
    assert out.status == "anchored"
    assert PLACEHOLDER not in out.text


def test_email_from_user_history_is_kept():
    out = guard_unverified_claims(
        "J'écris à martin@cabinet.fr comme demandé.",
        _ctx(user_corpus="Écris à martin@cabinet.fr"),
    )
    assert "martin@cabinet.fr" in out.text
    assert out.status == "anchored"


def test_phone_formatting_difference_is_kept():
    out = guard_unverified_claims(
        "Téléphone : 06 12 34 56 78.",
        _ctx(evidence="tel +33 6 12 34 56 78"),
    )
    assert "06 12 34 56 78" in out.text
    assert out.status == "anchored"


def test_amount_spacing_is_kept_when_number_is_in_evidence():
    out = guard_unverified_claims(
        "Le devis est de 1 200 €, à relancer cette semaine avec le détail du périmètre convenu.",
        _ctx(evidence="quote_total: 1200"),
    )
    assert "1 200 €" in out.text
    assert out.status == "anchored"


def test_invented_amount_and_percent_are_stripped():
    out = guard_unverified_claims(
        "Le devis est de 9 999 € et le taux de réponse observé est de 42 %, "
        "d'après le suivi commercial de la semaine.",
        _ctx(evidence="quote_total: 1200"),
    )
    assert "9 999" not in out.text
    assert "42" not in out.text
    assert out.status == "partial"
    assert PARTIAL_NOTE in out.text
    assert PLACEHOLDER in out.text


def test_invented_url_and_date_are_stripped():
    out = guard_unverified_claims(
        "Le dossier est sur https://evil.example/secret et la relance est fixée au 08/10/2026, "
        "avec le compte-rendu déjà validé dans le fil.",
        _ctx(evidence="relance 2026-11-02"),
    )
    assert "evil.example" not in out.text
    assert "08/10/2026" not in out.text
    assert out.status == "partial"


def test_product_url_is_allowlisted():
    out = guard_unverified_claims(
        "L'interface est sur https://korymb.eludein.art.",
        _ctx(intent="chat"),
    )
    assert "korymb.eludein.art" in out.text
    assert out.status == "anchored"


def test_lookup_question_loads_crm_evidence(monkeypatch):
    import services.chat_intelligence as ci

    monkeypatch.setattr(ci, "classify_chat_intent", lambda _text: "chat")
    monkeypatch.setattr(
        ci,
        "build_chat_grounding_block",
        lambda _text, intent=None: "martin@cabinet.fr",
    )
    ctx = claim_context(user_text="quel est l'email ?")
    assert ctx.intent == "crm"
    assert "martin@cabinet.fr" in ctx.evidence
