# Accès VPS — pointeur

La fiche complète et le dossier Cursor de gestion sont ici :

**`C:\workspace-vps\VPS-SSH.md`**

Ouvrir `C:\workspace-vps` pour travailler sur le VPS et Hermes. Le compose et les scripts shell de ce dossier `ops/hermes` y sont liés. Les scripts PowerShell restent dans `scripts\` de ce dépôt.

Faits stables, pour ne pas chercher :

- Coolify / Hermes : `root@187.124.42.135` (hostname `srv1498916`). Alias SSH `fleur-vps` et `VPSEludeInArtRoot`. Clé `C:\Users\eludi\.ssh\id_ed25519` (commentaire `deploy-fleur-amours`, empreinte `SHA256:3tF136z3naRuipyqIfgA5+Fsv1ebgpVNVmv8iHQvBU4`, sans phrase secrète). BatchMode fonctionne.
- Site mutualisé : alias `eludein` / `hostinger-eludein`, `92.113.28.43` port `65002`. Ce n'est pas ce VPS.
- Clé du conteneur Hermes : `/docker/hermes-agent-aoxw/data/.ssh/id_ed25519` sur le serveur, vers `root@10.0.3.1`. Pas la clé du PC.
