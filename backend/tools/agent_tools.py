"""
tools/agent_tools.py — Outils augmentés KORYMB v3.

Trois outils principaux utilisables par les agents (tags "knowledge", "validate") :
  - search_core_notes    : recherche dans les notes CORE et la documentation
  - validate_syntax      : sandbox de vérification syntaxique (Python, JS/TS)
  - get_fleet_status     : constantes d'actifs Élude In Art (Ti Spoun / Sivana / Éric)
"""
from __future__ import annotations

import ast
import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Dossiers où chercher les notes CORE
_CORE_SEARCH_DIRS: list[str] = [
    "docs",
    "CORE",
    "notes",
    ".cursor/rules",
    ".cursor/skills",
]

# Extensions de fichiers texte indexées
_TEXT_EXTENSIONS: frozenset[str] = frozenset({
    ".md", ".txt", ".mdc", ".rst", ".json", ".yaml", ".yml",
})
_CODE_SEARCH_DIRS: list[str] = ["backend", "admin"]
_CODE_EXTENSIONS: frozenset[str] = frozenset({".py", ".ts", ".tsx"})
_CODE_SKIP_PARTS: frozenset[str] = frozenset({
    "node_modules", ".next", "__pycache__", ".venv", "dist", ".git", "coverage",
})
_CODE_MAX_BYTES = 80_000


def _path_skipped(path: Path) -> bool:
    return any(part in _CODE_SKIP_PARTS for part in path.parts)


def _collect_note_hits(
    query_terms: list[str],
    *,
    dirs: list[str],
    extensions: frozenset[str],
    context_chars: int,
    max_scan: int,
    skip_code_layout: bool,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for dir_name in dirs:
        target = _REPO_ROOT / dir_name
        if not target.exists():
            continue
        for path in sorted(target.rglob("*")):
            if skip_code_layout and _path_skipped(path):
                continue
            if path.suffix.lower() not in extensions:
                continue
            if not path.is_file():
                continue
            try:
                if path.stat().st_size > _CODE_MAX_BYTES:
                    continue
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            text_lower = text.lower()
            if not all(t in text_lower for t in query_terms):
                continue
            pos = text_lower.find(query_terms[0])
            start = max(0, pos - 80)
            end = min(len(text), pos + context_chars)
            excerpt = text[start:end].strip()
            results.append({
                "path": str(path.relative_to(_REPO_ROOT)).replace("\\", "/"),
                "excerpt": excerpt,
                "score": sum(text_lower.count(t) for t in query_terms),
            })
            if len(results) >= max_scan:
                return results
    return results


def search_core_notes(
    query: str,
    *,
    max_results: int = 8,
    context_chars: int = 400,
    include_code: bool = True,
) -> str:
    """
    Recherche docs CORE + (optionnel) extraits lecture seule de backend/ et admin/.
    """
    query_clean = (query or "").strip()
    if not query_clean:
        return "Requête vide."

    terms = [t.lower() for t in query_clean.split() if t][:8]
    if not terms:
        return "Requête vide."

    docs = _collect_note_hits(
        terms,
        dirs=_CORE_SEARCH_DIRS,
        extensions=_TEXT_EXTENSIONS,
        context_chars=context_chars,
        max_scan=max_results * 3,
        skip_code_layout=False,
    )
    code: list[dict[str, Any]] = []
    if include_code:
        code_terms = terms[:4]
        code = _collect_note_hits(
            code_terms,
            dirs=_CODE_SEARCH_DIRS,
            extensions=_CODE_EXTENSIONS,
            context_chars=min(context_chars, 280),
            max_scan=max_results * 2,
            skip_code_layout=True,
        )

    docs.sort(key=lambda r: r["score"], reverse=True)
    code.sort(key=lambda r: r["score"], reverse=True)
    doc_n = max(1, max_results - 3) if code else max_results
    picked = docs[:doc_n]
    remaining = max(0, max_results - len(picked))
    picked.extend(code[:remaining])

    if not picked:
        return f"Aucun résultat pour '{query_clean}' dans les notes / le code Korymb."

    lines: list[str] = [f"## Résultats pour '{query_clean}' ({len(picked)} fichiers)"]
    for r in picked:
        lines.append(f"\n### `{r['path']}`")
        lines.append(f"```\n{r['excerpt'][:context_chars]}\n```")
    return "\n".join(lines)


# ── validate_syntax ────────────────────────────────────────────────────────────

def validate_syntax(code: str, language: str = "python") -> dict[str, Any]:
    """
    Vérifie la syntaxe d'un bloc de code sans l'exécuter.

    Langages supportés :
    - python  : ast.parse() (natif, sans subprocess)
    - js / javascript / ts / typescript : node --check (si Node.js disponible)

    Returns:
        {"valid": bool, "errors": list[str], "language": str, "warnings": list[str]}
    """
    lang = (language or "python").strip().lower()
    code_clean = (code or "").strip()

    if not code_clean:
        return {"valid": False, "errors": ["Code vide."], "language": lang, "warnings": []}

    # ── Python ────────────────────────────────────────────────────────────────
    if lang == "python":
        try:
            ast.parse(code_clean)
            return {"valid": True, "errors": [], "language": lang, "warnings": []}
        except SyntaxError as e:
            return {
                "valid": False,
                "errors": [f"SyntaxError ligne {e.lineno}: {e.msg}"],
                "language": lang,
                "warnings": [],
            }
        except Exception as e:
            return {"valid": False, "errors": [str(e)], "language": lang, "warnings": []}

    # ── JavaScript / TypeScript ───────────────────────────────────────────────
    if lang in ("js", "javascript", "ts", "typescript"):
        ext = ".ts" if lang in ("ts", "typescript") else ".js"
        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=ext, delete=False, encoding="utf-8") as f:
                f.write(code_clean)
                tmp_path = f.name
            cmd = ["node", "--check", tmp_path] if ext == ".js" else ["tsc", "--noEmit", "--strict", tmp_path]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            Path(tmp_path).unlink(missing_ok=True)
            if proc.returncode == 0:
                return {"valid": True, "errors": [], "language": lang, "warnings": []}
            errors = [line for line in (proc.stderr or proc.stdout or "").splitlines() if line.strip()]
            return {"valid": False, "errors": errors[:20], "language": lang, "warnings": []}
        except FileNotFoundError:
            return {
                "valid": False,
                "errors": [f"Runtime '{cmd[0]}' non trouvé — vérification non disponible."],
                "language": lang,
                "warnings": ["Installe node.js pour valider le JS/TS."],
            }
        except Exception as e:
            return {"valid": False, "errors": [str(e)], "language": lang, "warnings": []}

    return {
        "valid": False,
        "errors": [f"Langage '{lang}' non supporté. Langages valides : python, js, ts."],
        "language": lang,
        "warnings": [],
    }


# ── get_fleet_status ───────────────────────────────────────────────────────────

def get_fleet_status() -> dict[str, Any]:
    """
    Retourne les constantes d'actifs de l'Empire Élude In Art :
    Sivana, Ti Spoun, Éric, Fleur d'ÅmÔurs.

    Données fusionnées depuis le graphe de connaissance (si disponible) et
    les constantes statiques REALITY_ASSET_CONSTRAINTS.
    """
    # Constantes statiques (toujours disponibles)
    static_assets: dict[str, Any] = {
        "eric": {
            "role": "Dirigeant & créateur",
            "localisation": "Tourves, 83170, Var",
            "contact": "eludinart@gmail.com / 0659582428",
            "site": "eludein.art",
        },
        "sivana": {
            "type": "Écolieu",
            "contrainte": "Toute stratégie doit rester exécutable in situ",
            "capacite": "Ressources humaines et logistique locale limitées",
        },
        "ti_spoun": {
            "type": "Ancrage local artisanal",
            "contrainte": "Rythme artisanal — éviter stratégies déconnectées terrain",
            "valeurs": "Authenticité, proximité, lien humain",
        },
        "fleur_damours": {
            "type": "Tarot systémique (65 cartes)",
            "posture": "Non divinatoire — cartographie relationnelle",
            "cible": "Coachs, thérapeutes, facilitateurs, couples",
            "business": "Vente physique + séances + 7 Modules Pro + abonnements Stripe",
            "app": "app-fleurdamours.eludein.art",
        },
    }

    # Enrichissement depuis le graphe de connaissance (non bloquant)
    try:
        from services.knowledge import list_entities
        db_entities = {e["name"].lower(): e for e in list_entities()}
        for key, data in static_assets.items():
            canonical_name = key.replace("_", " ").replace("damours", "d'ÅmÔurs")
            for name, entity in db_entities.items():
                if key.split("_")[0] in name.lower():
                    data["_kb_attributes"] = entity.get("attributes", {})
                    data["_kb_relations"] = entity.get("relations", {})
                    break
    except Exception:
        pass

    return {
        "assets": static_assets,
        "source": "fleet_status_v1",
        "note": "Contraintes terrain actives : SÏvåñà (exécution in situ) + Ti Spoun (rythme artisanal).",
    }
