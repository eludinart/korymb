# Charte graphique — Élude In Art (site public)

Référence visuelle : le dossier tarot [`/le-tarot-fleur-damours-en-detail/`](https://eludein.art/le-tarot-fleur-damours-en-detail/).  
Toute évolution du thème enfant **reprend cette échelle**, cette palette et ces règles d’images. Ne pas réintroduire une typo plus petite « pour le reste du site ».

Implémentation : `wordpress/themes/eludein-child/assets/css/charter.css` (chargée après `layout.css`, réimprimée en CSS tardif pour LiteSpeed).

## Palette

| Token | Hex | Usage |
|-------|-----|--------|
| Forêt | `#3f4a3a` | Titres, liens, boutons |
| Forêt profond | `#243028` | Titres sur crème, footer |
| Or | `#c9a14a` / `#c4923a` | Accents, CTA sheen, filet |
| Crème | `#f4efe6` | Fond de page + halo or radial |
| Papier | `#fbf7f1` | Cartes, header |
| Sable | `#8a6230` | Survol, kicker |
| Encre | `#1a1816` / `#2a2622` | Corps de texte |

Pas de cyan OceanWP (`#13aff0`). Pas d’or pâle `#e9c764` sur titres boutique.

## Typographie

- Titres : **Playfair Display** (serif), graisse 600, tracking `-0.02em`
- Corps : **Source Sans 3**
- Racine : `html` / `body` **22px**, interligne **1.7** (mobile : 20px dans `refresh.css`, le CSS tardif reste à 22px)

| Rôle | Taille |
|------|--------|
| h1 / titre boutique | `clamp(2.35rem, 4.2vw, 3.4rem)` |
| h2 / titre de page | `clamp(2.15rem, 3.4vw, 2.85rem)` |
| h3 | `clamp(1.55rem, 2.3vw, 2rem)` |
| Chapô / premier paragraphe | `1.48rem` / interligne 1.68 |
| Corps (p, li) | `1.32rem` / interligne 1.75 |
| Nav principale | 16px (px, pas rem) |
| CTA header | 14.5px |
| Salon widgets | compacte en px : titres 26px, cartes 18px, corps 15–16px |

Colonne de lecture (pages / articles, hors accueil et Woo) : **1040px**. Dossier tarot : **1120px**.

Le salon de widgets en bas de page **n’utilise pas** l’échelle lecture 1.32rem : titres Kadence / témoignages restent en px, sinon les cartes explosent.

Panier et commande : ne pas forcer `1.32rem` sur les paragraphes (champs et totaux restent lisibles).

## Images — quoi agrandir, quoi laisser

Les photos d’article / Gutenberg **remplissent leur cadre** (`width: 100%`, `height: auto`). On retire les `width="150"` / `sizes="…150px"` Gutenberg. Pas de float `alignleft` qui recouvre le texte. Les légendes **coupent aux espaces** (`overflow-wrap: break-word`, jamais `anywhere` ni `white-space: nowrap`).

**Ne jamais étirer :**

| Élément | Comportement |
|---------|----------------|
| Logo header (`.custom-logo`, `#site-logo img`) | `width: auto`, `max-height: 76–78px` |
| Emojis / smileys | `1em` |
| Avatars | taille native |
| Fleur (`#fleur-container`, `#fleur-duo-container`) | inchangé |
| Résultat Fleur (`#result-fleur img`) | `max-width: 340px` |
| Cartes boutique (`.woo-entry-image`, `ul.products li.product img`) | crop **280px**, `object-fit: cover` |
| Galerie produit Woo | `height: auto`, `object-fit: contain` |
| Images Gutenberg `is-resized` | respecter la taille auteur |

Tableaux Gutenberg **qui contiennent des images** (hors Woo) : grille CSS, comme le dossier tarot.

## WooCommerce — interdit

- Jamais `display: contents` ni CSS Grid sur `.shop_table`, checkout review, panier, compte.
- Ces tableaux restent `display: table` / `table-row` / `table-cell`.
- Checkout : garder `billing_*` et `#place_order` visibles. Pas de `woocommerce/*.php` dans le child.

## Voix (rappel)

Structure, cartographie, circulation, clarté — pas de voyance. Ne pas réécrire le copy d’Éric.

## À l’avenir

1. Lire cette charte **avant** de toucher le CSS du child.
2. Si une page « paraît trop grande », ce n’est pas un bug : 22px est la taille du site.
3. Nouveau composant : réutiliser les tokens `--eludein-*` de `refresh.css`, pas de nouvelles couleurs.
4. Toute exception image (logo, Fleur, Woo) se documente ici et dans `charter.css`.
