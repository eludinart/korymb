"""
knowledge.py — Base de connaissance de la Fleur d'ÅmÔurs.

Charge les données depuis /knowledge/ et expose des fonctions de recherche
utilisables comme outils par les agents CrewAI.
"""
import json
import os
from pathlib import Path
from crewai.tools import tool

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

# ── Chargement des données ──────────────────────────────────────────────────

def _load_json(filename: str) -> list | dict:
    path = KNOWLEDGE_DIR / filename
    if not path.exists():
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        return json.load(f)

def _load_text(filename: str) -> str:
    path = KNOWLEDGE_DIR / filename
    if not path.exists():
        return ""
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()

_CARDS: list = _load_json("cards.json")
_PAGES: list = _load_json("manual_pages.json")
_SITE: str   = _load_text("eludein_site.txt")

# ── Contexte système injecté dans chaque agent ─────────────────────────────

FLEUR_CONTEXT = """
# La Fleur d'ÅmÔurs — Contexte essentiel

## Ce que c'est
Le Tarot Fleur d'ÅmÔurs est un **outil d'analyse systémique** créé par Éric (Élude In Art),
entrepreneur individuel basé à Tourves (83170, Var). Ce n'est PAS un outil de divination.
C'est une boussole pour cartographier les dynamiques relationnelles, émotionnelles et de projet.

## Structure du jeu (65 cartes en 4 familles)
1. **Les 8 Formes d'Amour** : Agapé (don sans attente), Éros (désir/intensité),
   Philia (amitié/réciprocité), Storgé (attachement familial), Pragma (amour construit),
   + 3 autres formes
2. **Le Cycle du Végétal** : de la graine au nectar — croissance, floraison, transformation
3. **Les Cycles des Éléments** : Terre, Eau, Air, Feu, Éther
4. **Le Cycle de la Vie** : naissance, métamorphoses, passages, transmission

## À quoi ça sert
- Cartographier les dynamiques d'un système (relationnel, collectif, projet)
- Identifier les ressources, tensions, cycles en cours
- Support de médiation symbolique en accompagnement professionnel
- NE PRÉDIT PAS L'AVENIR — décrit ce qui est cultivé

## Usages
- **Tirages** : À une carte, Les 4 Portes du Jardin, La Fleur déployée, Le Conseil des 8 Amours
- **Constellations systémiques** de la Fleur d'ÅmÔurs (couples, polyamour, groupes)
- **Modules Pro** (7 modules) pour coachs, thérapeutes, facilitateurs
- **Questionnaires Ritual** : Fleur individuelle (24 questions), Fleur Duo

## Le business d'Élude In Art (Éric)
- **Produits** : Tarot physique (65 cartes), séances individuelles à distance
- **Services** : Accompagnement relationnel, facilitation, constellations, stages & ateliers
- **Espaces numériques** : Espace Membres, Espace Pro, boutique en ligne
- **Autre** : VIBRÆ (travail perceptif par le son), SÏvåñà (écolieu dans le Haut-Var)
- **Contact** : eludinart@gmail.com / 0659582428
- **Site** : eludein.art

## Positionnement
"Déchiffrer les systèmes, cultiver le vivant."
Public cible : coachs, thérapeutes, facilitateurs, couples, professionnels de l'accompagnement.
Prix moyen séance : accompagnement individuel/distance.
Le tarot est vendu en pré-commande, expédition après tirage.
"""


# ── Outils pour les agents ──────────────────────────────────────────────────

@tool("Rechercher dans la base de connaissance Fleur d'ÅmÔurs")
def search_knowledge(query: str) -> str:
    """
    Recherche dans la base de connaissance complète de la Fleur d'ÅmÔurs.
    Retourne les extraits pertinents du manuel, des cartes et du site web.
    Utilise cet outil pour toute question sur le tarot, les formes d'amour,
    les usages, les tirages, ou le business d'Élude In Art.
    """
    q = query.lower()
    results = []

    # Recherche dans les cartes
    for card in _CARDS:
        card_text = json.dumps(card, ensure_ascii=False).lower()
        if q in card_text:
            results.append(f"[CARTE] {card.get('nom','?')} ({card.get('type','?')}) — {card.get('resume','')}")

    # Recherche dans les pages du manuel
    for page in _PAGES:
        texte = page.get("texte", "")
        if q in texte.lower():
            results.append(f"[MANUEL p.{page.get('page','?')}] {texte[:300]}...")

    # Recherche dans le contenu du site
    lines = _SITE.split("\n")
    for i, line in enumerate(lines):
        if q in line.lower() and len(line.strip()) > 20:
            context = " ".join(lines[max(0,i-1):i+2])
            results.append(f"[SITE] {context[:300]}")

    if not results:
        return f"Aucun résultat trouvé pour '{query}'. Utilise le contexte général : {FLEUR_CONTEXT[:500]}"

    return "\n\n".join(results[:8])  # max 8 résultats


@tool("Obtenir le contexte complet de la Fleur d'ÅmÔurs")
def get_fleur_context(topic: str = "general") -> str:
    """
    Retourne le contexte complet sur la Fleur d'ÅmÔurs et le business d'Élude In Art.
    Utilise cet outil au début de toute mission liée à la Fleur d'ÅmÔurs.
    topic peut être : 'general', 'cartes', 'business', 'usage', 'manuel'
    """
    if topic == "cartes" and _CARDS:
        cartes_summary = "\n".join([
            f"- {c.get('nom','?')} ({c.get('type','?')}) : {c.get('resume','')}"
            for c in _CARDS[:20]
        ])
        return f"{FLEUR_CONTEXT}\n\n## Cartes disponibles :\n{cartes_summary}"

    if topic == "manuel" and _PAGES:
        intro = "\n".join([
            f"Page {p.get('page','?')}: {p.get('texte','')[:200]}"
            for p in _PAGES[:10]
        ])
        return f"{FLEUR_CONTEXT}\n\n## Extrait du manuel :\n{intro}"

    if topic == "business":
        # Retourne les infos site focalisées business
        business_lines = [l for l in _SITE.split("\n") if any(
            k in l.lower() for k in ["produit","séance","boutique","accompagnement","module","stage","atelier","prix","contact"]
        )]
        return f"{FLEUR_CONTEXT}\n\n## Pages business :\n" + "\n".join(business_lines[:30])

    return FLEUR_CONTEXT
