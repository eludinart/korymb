from services.chat_mirror import finalize_mirror_ack


def test_finalize_mirror_ack_strips_incomplete_footnote():
    raw = """Je lance l'analyse en tâche de fond :

- Audit Resalib PACA
- Benchmark des 20 premiers profils
- Tableau de prospection structuré

**Prochaine étape** → notification dans le chat avec le plan d'action.

*(Je mobilise l'agent commercial **uniquement si** les leads nécessitent une"""
    out = finalize_mirror_ack(raw)
    assert "mobilise" not in out.lower() or "notifi" in out.lower()
    assert out.endswith(".") or "prête" in out.lower()
    assert "*(Je" not in out


def test_finalize_mirror_ack_repairs_colon_truncation():
    raw = """Je lance l'exploration en tâche de fond :

1. Je vérifie les dossiers partagés.
2. Je croise avec le commercial.
3. Je valide la structure du CSV.

---

Tu seras prévenu dès que je peux te partager :"""
    out = finalize_mirror_ack(raw)
    assert out.endswith(".")
    assert ":" not in out.split("\n")[-1]
    assert "notifi" in out.lower() or "cloche" in out.lower()


def test_finalize_mirror_ack_keeps_complete_text():
    raw = (
        "Je reformule votre besoin : localiser le fichier CSV prioritaire.\n\n"
        "Je lance l'analyse en tâche de fond — vous serez notifié ici et via la cloche dès que c'est prêt."
    )
    out = finalize_mirror_ack(raw)
    assert "localiser le fichier CSV" in out
    assert "notifié" in out


def test_finalize_mirror_ack_appends_closing_when_missing():
    out = finalize_mirror_ack("Je m'occupe de votre demande sur les exports clients.")
    assert "arrière-plan" in out.lower() or "notifi" in out.lower()
