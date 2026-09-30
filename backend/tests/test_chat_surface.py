from services.chat_surface import surface_chat_result


def test_surface_chat_strips_reprise_and_global_context():
    raw = """Contexte global :
Projet de reprise Élude In Art — cession en cours.

[Reprise — Conformité & RGPD]
- Vérifier le registre des traitements
- Vérifier le registre des traitements
- Vérifier le registre des traitements

Je consulte l'historique des missions pour retrouver les infos.

Aujourd'hui nous sommes le 24 juin 2026."""
    out = surface_chat_result(raw)
    assert "Reprise" not in out
    assert "Contexte global" not in out
    assert "registre des traitements" not in out
    assert "historique des missions" not in out
    assert "24 juin 2026" in out


def test_surface_chat_keeps_short_direct_answer():
    assert surface_chat_result("Bonjour, comment puis-je vous aider ?") == "Bonjour, comment puis-je vous aider ?"


def test_surface_chat_strips_questions_pour_la_suite_and_qcm():
    raw = """## Synthèse
Priorise le PWA et le HITL.

## Questions pour la suite
1. Quelles améliorations d'interface prioriser ?
2. Comment améliorer la mémoire ?

```korymb-qcm
{"title": "x", "questions": []}
```
"""
    out = surface_chat_result(raw)
    assert "Priorise le PWA" in out
    assert "Questions pour la suite" not in out
    assert "korymb-qcm" not in out
    assert "améliorations d'interface" not in out


def test_surface_chat_can_keep_questionnaire_when_requested():
    raw = "Voici le QCM:\n\n```korymb-qcm\n{\"title\": \"x\", \"questions\": []}\n```\n"
    out = surface_chat_result(raw, keep_questionnaire=True)
    assert "korymb-qcm" in out
