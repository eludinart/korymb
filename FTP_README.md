Connexion FTP au WordPress public (https://eludein.art) — Hostinger hPanel, **pas** le VPS Coolify.

1. Copier `.ftpconfig.example` vers `.ftpconfig` (déjà gitignoré).
2. Coller le mot de passe FTP depuis hPanel → FTP Accounts.
3. `python scripts/wp_theme_sync.py status`

Le sync n’envoie que `wordpress/themes/eludein-child/`.
Guide : [docs/WORDPRESS-THEME.md](docs/WORDPRESS-THEME.md)
