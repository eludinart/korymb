---
name: coolify-deploy
description: >-
  Commit, push et déploiement Coolify Korymb (front Next / back FastAPI) via SSH
  et helpers PHP dans le conteneur coolify. À utiliser quand l'utilisateur demande
  commit+push+deploy, redeploy, ou « déploie ».
---

# Coolify deploy (Korymb)

## Quand

Dès que l’utilisateur dit **commit + push + déploie** (ou équivalent). Ne pas redécouvrir la méthode : suivre ce skill + `scripts/coolify-deploy.ps1`.

## Choix front / back / both

Règle déjà dans `.cursor/rules/deploy-after-push.mdc` :

| Diff | Target |
|------|--------|
| `admin/`, `Dockerfile` racine, Next | `front` |
| `backend/` | `back` |
| les deux / contrat API | `both` |
| docs / skills / ops hors runtime | ne pas déployer |

Bump `next` / `package-lock` admin → **front seulement**.

## Procédure standard

1. **Commit** (seulement si demandé) — style messages FR du repo ; pas de secrets.
2. **Push** `git push -u origin HEAD` (demande explicite).
3. **Déployer** :

```powershell
.\scripts\coolify-deploy.ps1 -Target front   # ou back | both
```

Le script :

- SSH `$env:KORYMB_VPS_SSH` ou `root@187.124.42.135`
- scp `scripts/coolify/*.php` → conteneur `coolify`
- file `queue_application_deployment` (force rebuild HEAD)
- poll jusqu’à `finished` (un service à la fois ; si `both`, **back puis front**)
- smoke : `node tools/smoke-post-deploy.mjs`

## UUIDs Coolify (prod)

| Service | UUID | URL |
|---------|------|-----|
| Front | `z112nva69fa5wvvsku0rey6b` | https://korymb.eludein.art |
| Back | `q3fnxjqmpfnlr77wfk1wn9ls` | https://api-korymb.eludein.art |

Rafraîchir la liste :

```powershell
# après Ensure-Helpers du script, ou manuellement :
ssh root@187.124.42.135 "docker exec coolify php /tmp/list-korymb-apps.php"
```

## Garde-fous

- **Un seul** build Coolify à la fois (RAM VPS ~8 GiB ; `next build` peut exit 255 sans swap).
- Si build 255 : vérifier swap `/swapfile`, `docker builder prune -af`, relancer **un** deploy.
- Ne pas committer `.dev-logs/`, `.env`, secrets.
- Après succès : mentionner **À redéployer : déjà fait (…)** + smoke OK/KO.

## Manuel (si le .ps1 casse)

```powershell
$ssh = if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }
scp scripts/coolify/*.php "${ssh}:/tmp/"
ssh $ssh "docker cp /tmp/queue-by-uuid.php coolify:/tmp/; docker cp /tmp/deploy-status.php coolify:/tmp/"
# front :
$id = (ssh $ssh "docker exec coolify php /tmp/queue-by-uuid.php z112nva69fa5wvvsku0rey6b").Trim()
# poll :
ssh $ssh "docker exec coolify php /tmp/deploy-status.php $id"
```
