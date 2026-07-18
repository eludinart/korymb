---
name: eludein-backup-checklist
category: devops
description: Checklist backup et restauration — MariaDB, data Hermes, certificats. Vérification sans restaurer.
---

# Backup checklist Élude In Art

Activer `eludein-ops-rules`, `coolify-services-map`.

## Périmètre à sauvegarder

| Asset | Emplacement | Priorité |
|-------|-------------|----------|
| MariaDB prod | conteneur `juehpsnqkm60d2o6dhs38c5t` | P0 |
| Hermes data | `/docker/hermes-agent-aoxw/data/` | P0 |
| Hermes compose | `/docker/hermes-agent-aoxw/docker-compose.yml` | P1 |
| Certificats Traefik | volumes Coolify | P1 |

## Vérifications (lecture seule)

### Taille data Hermes

```bash
du -sh /docker/hermes-agent-aoxw/data/
ls -la /docker/hermes-agent-aoxw/data/.env /docker/hermes-agent-aoxw/data/skills/ | head -20
```

### MariaDB accessible

```bash
/opt/data/scripts/eludein-db-check.sh
```

### Dernier dump connu (si répertoire backup existe)

```bash
ls -lt /root/backups/ /var/backups/ /docker/backups/ 2>/dev/null | head -15 || echo "Aucun répertoire backup standard trouvé"
```

## Dump manuel (uniquement si Éric demande)

```bash
# Exemple — ne pas exécuter sans accord
docker exec juehpsnqkm60d2o6dhs38c5t mariadb-dump -uroot -p'***' default > /tmp/korymb-backup.sql
```

Ne **jamais** afficher le mot de passe root. Demander à Éric d'exécuter ou utiliser Coolify backup UI.

## Format livrable

```
💾 Backup checklist

Hermes data: {taille} — OK/KO
DB check: OK/KO
Dumps récents: …
Manques identifiés: …
Action recommandée: …
```

## Restauration

Ne **pas** restaurer autonomement. Documenter et escalader à Éric + Cursor si code/migrations impliqués.
