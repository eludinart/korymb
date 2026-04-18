"""
Script utilitaire pour construire un contexte enrichi depuis le manuel.
Exécuter une fois : python knowledge/build_context.py
"""
import json, re, pathlib

HERE = pathlib.Path(__file__).parent

def clean(text: str) -> str:
    """Supprime les artefacts d'encodage et nettoie le texte."""
    # Remplace les séquences d'encodage corrompues par les bons caractères
    replacements = [
        ("d\ufffd\ufffdm\ufffdurs", "d'Amours"), ("d\ufffd \ufffdm\ufffdurs", "d'Amours"),
        ("\ufffd\ufffdm\ufffdurs", "Amours"), ("d\ufffd\ufffdm\ufffdur", "d'Amour"),
        ("\ufffd\ufffd", "é"), ("\ufffd", "e"),
        ("l\ufffd", "l'"), ("d\ufffd", "d'"), ("s\ufffd", "s'"), ("n\ufffd", "n'"),
        ("c\ufffd", "c'"), ("j\ufffd", "j'"), ("m\ufffd", "m'"),
    ]
    for bad, good in replacements:
        text = text.replace(bad, good)
    # Nettoyer les espaces multiples
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def build():
    pages = json.loads((HERE / "manual_pages.json").read_text(encoding="utf-8", errors="replace"))

    sections = []
    current_section = []

    for p in pages:
        text = clean(p.get("texte", ""))
        if len(text) > 30:
            current_section.append(f"[p{p['page']}] {text}")
        if len(current_section) >= 5:
            sections.append("\n".join(current_section))
            current_section = []
    if current_section:
        sections.append("\n".join(current_section))

    full_text = "\n\n".join(sections)
    (HERE / "manuel_complet.txt").write_text(full_text, encoding="utf-8")
    print(f"Manuel construit : {len(full_text)} caractères, {len(pages)} pages")
    return full_text

if __name__ == "__main__":
    build()
