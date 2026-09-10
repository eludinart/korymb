# Site WordPress Élude In Art — thème enfant

Le site public **https://eludein.art** est un WordPress Hostinger (hPanel + LiteSpeed), **pas** le VPS Coolify. C’est l’interface de vente WooCommerce (tarot + séance).

Ce dépôt ne versionne **que** le thème enfant `eludein-child`. Le moteur WordPress, OceanWP parent, WooCommerce et les plugins restent sur l’hébergement.

## Garde-fous

| On touche | On ne touche pas |
|-----------|------------------|
| `wordpress/themes/eludein-child/` (CSS, `functions.php`) | `wp-admin`, `wp-includes`, `wp-config.php` |
| Habillage boutique (cartes, boutons, typo) | Plugins WooCommerce / paiements |
| CSS Fleur duo / individuelle (repris du Personnaliser) | Contenu des pages, produits, commandes |

OceanWP **reste le thème parent**. Le child n’ajoute aucun template `woocommerce/*.php` : panier, commande et compte gardent le markup WooCommerce.

## État actuel (relevé public, sept. 2026)

| Élément | Valeur |
|---------|--------|
| URL | https://eludein.art |
| CMS | WordPress + OceanWP 4.2.2 |
| Page builders | Gutenberg + Kadence Blocks |
| Boutique | WooCommerce (`/boutique/`, `/panier/`, `/commander/`, `/mon-compte/`) |
| Produits | Tarot Fleur d’ÅmÔurs (69 €) · Séance d’orientation (90 €) |
| Cache | LiteSpeed |
| Hébergeur | Hostinger hPanel (FTP historique : user `u945541167`) |

Aucun thème enfant n’était exposé publiquement : les overrides vivaient dans le CSS additionnel du Personnaliser. Ils sont repris dans `assets/css/legacy-custom.css` (avec correction du `table { width:50% }` qui cassait le tableau de commande).

## Travailler dans Cursor

```text
wordpress/themes/eludein-child/
  style.css                 # identité du thème (Template: oceanwp)
  functions.php             # enqueue CSS uniquement
  assets/css/legacy-custom.css
  assets/css/refresh.css
  assets/css/woocommerce.css
```

Aperçu local (sans WordPress) : ouvrir `wordpress/preview/index.html`.

## Publier le thème (sans FTP)

```bash
python scripts/wp_theme_pack.py
```

Puis dans l’admin WordPress : **Apparence → Thèmes → Ajouter → Téléverser** le zip `wordpress/dist/eludein-child.zip`, et **activer** « Élude In Art Child ».

Après activation : vider le cache LiteSpeed (hPanel ou plugin). Vérifier `/boutique/`, une fiche produit, `/panier/` et `/commander/` avant de communiquer.

## Brancher FTP (pour pull/push depuis Cursor)

1. hPanel Hostinger → **FTP Accounts** → mot de passe du compte `u945541167` (ou un compte dédié `theme-sync`).
2. Copier `.ftpconfig.example` vers `.ftpconfig` (gitignoré).
3. Coller le mot de passe. Si le login échoue, tester `"secure": false` (FTP) ou le hostname FTP indiqué par hPanel.
4. Si le thème n’apparaît pas, ajuster `remotePath` (`/public_html/...` ou `/domains/eludein.art/public_html/...`).

```bash
python scripts/wp_theme_sync.py status
python scripts/wp_theme_sync.py push    # child theme only
python scripts/wp_theme_sync.py pull
```

Le script **refuse** tout chemin distant qui ne finit pas par `eludein-child`.

## Après un déploiement visuel

- [ ] Accueil https://eludein.art
- [ ] Boutique + 2 fiches produit
- [ ] Panier → commande (champs toujours visibles)
- [ ] Mon compte
- [ ] Questionnaire Fleur (`#fleur-container` / `#fleur-duo-container`)
- [ ] Cache LiteSpeed vidé
