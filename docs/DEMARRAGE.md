# Démarrage de l'environnement de dev (Windows / Cursor)

Guide pour lancer Korymb en local : backend FastAPI (port 8020) + frontend Next.js (port 3000) + tunnel SSH vers MariaDB sur le VPS (port local 3307).

## TL;DR

```powershell
# Depuis la racine du repo
.\start-dev-cursor.ps1 -MariaDbTunnel
```

Puis ouvrir :

- Frontend : http://127.0.0.1:3000/briefing (ou /dashboard)
- Backend : http://127.0.0.1:8020/health

Arrêt : `Ctrl+C` dans le terminal, ou `.\stop-dev-cursor.ps1`.

## Prérequis (une seule fois)

```powershell
npm install                                       # dépendances racine
npm --prefix admin install                        # dépendances frontend Next.js
python -m pip install -r backend/requirements.txt # dépendances backend
```

Variables d'environnement :

```powershell
copy .env.example .env.local
copy backend\.env.example backend\.env
```

Vérifier que les secrets correspondent entre les deux fichiers :

| Fichier | Variable |
|---|---|
| `backend/.env` | `AGENT_API_SECRET` |
| `.env.local` | `KORYMB_AGENT_SECRET` et `NEXT_PUBLIC_KORYMB_AGENT_SECRET` |

La base de données est configurée dans `backend/.env.local` (`KORYMB_DB_ENGINE=mariadb`, `KORYMB_DB_PORT=3307`). En mode MariaDB, le backend passe par un tunnel SSH vers le VPS — d'où l'option `-MariaDbTunnel` ci-dessous.

## Démarrage

```powershell
.\start-dev-cursor.ps1 -MariaDbTunnel
```

Le script fait tout dans le terminal courant, dans cet ordre :

1. Libère les ports 8020 et 3000-3002 (tue les anciens processus).
2. Ouvre le tunnel SSH MariaDB (`127.0.0.1:3307` → VPS `3306`).
3. Démarre le backend via `backend/restart.ps1` (uvicorn, processus détaché) et attend que `/health` réponde avec le bon `code_dir` et la bonne version.
4. Démarre le frontend Next.js (`next dev -p 3000`, processus détaché).
5. Reste en avant-plan : il streame les logs backend et un **watchdog** vérifie `/health/live` toutes les 15 s. Après 4 échecs consécutifs, il redémarre automatiquement le backend (idem pour le frontend et le tunnel s'ils tombent).

Le démarrage complet prend environ 1 à 2 minutes (compilation Next incluse).

### Options du script

| Option | Effet |
|---|---|
| `-MariaDbTunnel` | Ouvre le tunnel SSH MariaDB au démarrage. **Requis** si `KORYMB_DB_ENGINE=mariadb`. |
| `-SkipVerify` | Ne pas attendre `/health` avant de lancer le frontend (dépannage). |
| `-Reload` | Active `uvicorn --reload` (désactivé par défaut car instable sous Windows). |

## Vérifier que tout tourne

```powershell
Invoke-RestMethod http://127.0.0.1:8020/health          # backend : version + code_dir
Invoke-RestMethod http://127.0.0.1:8020/health/database # connexion MariaDB
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing # frontend : HTTP 200
```

Attendu : `/health/database` retourne `"connected": true` avec `engine: mariadb`, `port: 3307`.

## Arrêt

- `Ctrl+C` dans le terminal qui exécute le script (arrête proprement backend + frontend), ou
- `.\stop-dev-cursor.ps1` depuis un autre terminal.

## Logs et dépannage

Les logs sont écrits dans `.dev-logs/` à la racine :

| Fichier | Contenu |
|---|---|
| `backend.log` | stdout du backend (uvicorn) |
| `backend.err.log` | stderr du backend (tracebacks Python) |
| `frontend.out.log` / `frontend.err.log` | logs Next.js |

Problèmes courants :

- **« Backend non pret sur /health apres attente »** : regarder `.dev-logs/backend.err.log` — c'est presque toujours une erreur Python à l'import (traceback complet dedans). Le watchdog retente automatiquement ; un cache `__pycache__` périmé est purgé au redémarrage par `restart.ps1`.
- **Briefing / missions / audit échouent avec MariaDB configurée** : le tunnel SSH est fermé. Relancer avec `-MariaDbTunnel`, ou vérifier `Get-NetTCPConnection -LocalPort 3307 -State Listen`.
- **Port déjà occupé** : le script libère les ports lui-même au démarrage ; il suffit de le relancer.
- **Next.js introuvable** : lancer `npm --prefix admin install`.

## Notes d'implémentation

- Backend et frontend tournent en **processus détachés** (pas en jobs PowerShell) : les jobs PS coupent uvicorn sous charge, et Next quitte après la première compilation s'il reste attaché au terminal parent.
- Le script exige PowerShell 5.1+ et fonctionne dans le terminal intégré de Cursor.
- Cible SSH du tunnel : `root@187.124.42.135` par défaut, surchargée par la variable d'environnement `KORYMB_VPS_SSH`.
