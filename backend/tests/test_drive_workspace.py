"""Export automatique Google Drive — parsing et anti-liens fictifs."""
from __future__ import annotations

from services.drive_workspace import (
    _collect_export_candidates,
    extract_exportable_content,
    is_meta_narrative_deliverable,
    markdown_table_to_csv,
    mission_implies_drive_export,
    parse_livrable_blocks,
    strip_fabricated_drive_links,
)


def test_mission_implies_drive_export_prospection():
    assert mission_implies_drive_export("liste de profils coachs PACA sur Resalib")
    assert mission_implies_drive_export("crée un fichier CSV sur mon Google Drive")


def test_parse_livrable_blocks():
    text = "#### LIVRABLE — Prospects PACA\n\n| Nom | Ville |\n| --- | --- |\n| Dupont | Toulon |\n"
    blocks = parse_livrable_blocks(text)
    assert len(blocks) == 1
    assert blocks[0]["title"] == "Prospects PACA"
    assert "Dupont" in blocks[0]["body"]


def test_markdown_table_to_csv():
    md = "| Nom | Ville |\n| --- | --- |\n| A | B |\n"
    csv = markdown_table_to_csv(md)
    assert csv is not None
    assert "Nom" in csv and "A" in csv


def test_strip_fabricated_drive_links():
    raw = (
        "Voir [fichier](https://drive.google.com/file/d/1XyZabc1234567890/view) "
        "*(remplacer XXXXX par le lien réel)*"
    )
    out = strip_fabricated_drive_links(raw)
    assert "1XyZabc" not in out
    assert "remplacer" not in out.lower()


def test_strip_keeps_real_drive_link():
    url = "https://drive.google.com/file/d/1WXMEULRy0k16xDMEYRgEY1XJXHfIlLv-/view"
    raw = f"Lien : [test]({url})"
    out = strip_fabricated_drive_links(raw)
    assert url in out


def test_rejects_meta_narrative_deliverable():
    body = (
        "Je lance l'analyse en tâche de fond :\n"
        "1. Je vérifie Resalib\n"
        "2. Je croise avec le commercial\n"
        "Prochaine étape : notification quand prêt."
    )
    assert is_meta_narrative_deliverable("Plan", body) is True
    assert extract_exportable_content("Plan", body) is None


def test_exports_letter_livrable():
    body = (
        "Objet : Partenariat constellation — Élude In Art\n\n"
        "Madame,\n\n"
        "Je me permets de vous contacter au sujet de notre accompagnement.\n\n"
        "Cordialement,\n"
        "Équipe Élude In Art"
    )
    out = extract_exportable_content("Courrier structure X", body)
    assert out is not None
    content, fmt = out
    assert fmt == "doc"
    assert "Madame" in content


def test_collect_candidates_skips_synthesis_dump():
    resultats = {
        "commercial": (
            "Voici mon analyse détaillée de la prospection sur 40 lignes...\n" * 20
        ),
    }
    candidates = _collect_export_candidates(
        mission_txt="prospection PACA",
        root_mission_label="Prospection",
        resultats=resultats,
        synthesis="Synthèse CIO longue " * 50,
        events=None,
    )
    assert candidates == []


def test_collect_candidates_keeps_livrable_table():
    resultats = {
        "commercial": (
            "#### LIVRABLE — Prospects PACA\n\n"
            "| Nom | Ville |\n| --- | --- |\n| Dupont | Toulon |\n"
        ),
    }
    candidates = _collect_export_candidates(
        mission_txt="tableau prospects",
        root_mission_label="Prospects",
        resultats=resultats,
        synthesis="",
        events=None,
    )
    assert len(candidates) == 1
    assert candidates[0]["format_kind"] == "sheet"
    assert "Dupont" in candidates[0]["body"]
