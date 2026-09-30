# Addendum décisions — Second cerveau (2026-09-30)

À **fusionner** dans `/opt/data/memories/decisions-eric.md` (ne pas écraser le fichier existant : append cette section).

## Architecture outils (ratifiée)

- Cœur opérationnel = **Cursor + Hermes + Korymb**.
- Toute amélioration d'environnement multi-jours ou multi-services passe par **Décisions / mission Korymb (HITL)** puis **Cursor**, puis smoke **Hermes**.
- Hermes n'approuve pas les envois ni ne lance de missions multi-agents coûteuses sans accord explicite d'Éric.
- Le dossier **`tronc/`** (banque skills Cursor) est la source de vérité à resynchroniser vers Hermes skills/memories et `korymb/ops`.

## Outcomes

Tenir une sous-section `## Outcomes` en bas de `decisions-eric.md` : date, job/mission, commit, smoke OK/FAIL, appris.

## Mandala

- Projet actif (repo `workspace-mandala`, URL mandala.eludein.art).
- Ne jamais interroger sa MariaDB avec `korymb-sql.sh` / `fleur-sql.sh`.
