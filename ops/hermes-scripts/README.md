# Hermes scripts (miroirs)

Dossier Cursor de gestion VPS : `C:\workspace-vps` (fiche SSH : `VPS-SSH.md`). Accès rappelé dans `ops/hermes/VPS-ACCESS.md`.

Copies sans secrets des scripts VPS — source live : `/opt/data/scripts/` (wrappers) et `/docker/hermes-agent-aoxw/data/scripts/` (dans le conteneur).

| Fichier | Déploiement cible |
|---------|-------------------|
| `eludein-db-check.sh` | conteneur `/opt/data/scripts/` |
| `host-eludein-db-check.sh` | hôte VPS `/opt/data/scripts/eludein-db-check.sh` |
| `mandala-sql.sh` | conteneur |
| `host-mandala-sql.sh` | hôte |
| `eludein-outcome-append.sh` | conteneur |
| `host-eludein-outcome-append.sh` | hôte |
| `eludein-korymb-open-session.sh` | conteneur / hôte (lit `.env`) |
| `eludein-post-deploy-smoke.sh` | conteneur / hôte |
| `eludein-telegram-send.sh` | lit `TELEGRAM_*` depuis `.env` |
| `fleur-card-of-day.sh` + `fleur-deck.json` | conteneur et hôte `/opt/data/scripts/` — carte du jour, pas de secret |
| `eludein-concert-record.sh` | journal concert (append + option Korymb/Telegram) |
| `host-eludein-concert-record.sh` | hôte → conteneur |
| `fleur_daily_card.py` | conteneur — carte du jour du cron « Post quotidien Fleur d'Amôurs » |

Les mots de passe / tokens restent dans `/opt/data/.env` sur le VPS — **jamais** dans git.

Déploiement : `.\scripts\hermes-intelligence-deploy.ps1` archive `ops/hermes-scripts/` puis `scripts/hermes-intel-remote-install.sh` copie les `*.sh` dans le volume conteneur (`/docker/hermes-agent-aoxw/data/scripts/`, vu comme `/opt/data/scripts/` par Hermès) et la liste hôte dans `/opt/data/scripts/` sur le VPS. `fleur-card-of-day.sh` et `fleur-deck.json` partent aux deux endroits. Le script lit le JSON à côté de lui. Le champ `url` pointe vers `https://app-fleurdamours.eludein.art/jardin/cartes/<slug>`.

Régénérer le jeu après un changement du manuel Fleur (l'ordre figé des 65 cartes est conservé, les cartes nouvelles s'ajoutent en queue) :

```bash
python3 ops/hermes-scripts/regen-fleur-deck.py /chemin/vers/fleur-amours
```
