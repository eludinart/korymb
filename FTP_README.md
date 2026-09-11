Connexion au WordPress public (https://eludein.art) — Hostinger hPanel, **pas** le VPS Coolify.

1. Copier `.ftpconfig.example` vers `.ftpconfig` (déjà gitignoré).
2. Coller le mot de passe dans `.ftpconfig` **uniquement** (jamais dans `.ftpconfig.example`).
3. `pip3 install paramiko && python3 scripts/wp_theme_sync.py status`

Protocole : SFTP port **65002** (le FTP :21 n’a pas de canal de données utilisable depuis Cursor Cloud).
Le sync n’envoie que `wordpress/themes/eludein-child/`.
Guide : [docs/WORDPRESS-THEME.md](docs/WORDPRESS-THEME.md)
