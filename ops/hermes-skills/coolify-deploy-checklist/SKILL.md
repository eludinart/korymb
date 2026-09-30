---
name: coolify-deploy-checklist
category: devops
description: Checklist post-deploy Coolify pour Fleur, Korymb, Mandala — health URLs, smoke, quand alerter Éric.
---

# Coolify deploy checklist

Après un déploiement (ou alerte), vérifier dans l'ordre :

1. `curl -s -o /dev/null -w '%{http_code}' https://api-korymb.eludein.art/health` → 200
2. `curl -s -o /dev/null -w '%{http_code}' https://korymb.eludein.art/` → 200
3. `curl -s -o /dev/null -w '%{http_code}' https://app-fleurdamours.eludein.art/jardin` → 200
4. `curl -s -o /dev/null -w '%{http_code}' https://mandala.eludein.art/` → 200
5. `/opt/data/scripts/eludein-db-check.sh` → STATUS: OK
6. Si script présent : `/opt/data/scripts/eludein-post-deploy-smoke.sh`

Si un check FAIL → Telegram Éric + brief Korymb (skill `eludein-second-cerveau`). Ne pas redéployer sans accord.
