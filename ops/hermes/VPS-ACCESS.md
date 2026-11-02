# Accès VPS — pointeur

La fiche complète et le dossier Cursor de gestion sont ici :

**`C:\workspace-vps\VPS-SSH.md`**

Ouvrir `C:\workspace-vps` pour travailler sur le VPS et Hermes. Le compose et les scripts shell de ce dossier `ops/hermes` y sont liés. Les scripts PowerShell restent dans `scripts\` de ce dépôt.

Faits stables, pour ne pas chercher (détails sensibles hors dépôt public — voir `VPS-SSH.md`) :

- Coolify / Hermes : utilisateur SSH et hôte via `$env:KORYMB_VPS_SSH` (alias locaux `fleur-vps` / `VPSEludeInArtRoot`). Clé privée locale, hors git.
- Site mutualisé : alias `eludein` / `hostinger-eludein` (Hostinger partagé). Ce n'est pas ce VPS.
- Clé du conteneur Hermes : `/docker/hermes-agent-aoxw/data/.ssh/id_ed25519` sur le serveur (passerelle Docker interne). Pas la clé du PC.
