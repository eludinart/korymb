<?php
/**
 * Élude In Art — thème enfant OceanWP.
 *
 * Couche visuelle uniquement :
 * - n’altère pas le cœur WordPress
 * - n’écrase pas les templates WooCommerce
 * - n’interrompt pas panier / commande / compte
 *
 * @package EludeinChild
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ELUDEIN_CHILD_VERSION', wp_get_theme()->get('Version') ?: '1.0.0');

/**
 * Feuilles du thème enfant, après OceanWP et WooCommerce.
 */
function eludein_child_enqueue_styles(): void
{
    $base = get_stylesheet_directory_uri();
    $ver = ELUDEIN_CHILD_VERSION;

    wp_enqueue_style(
        'eludein-child-legacy',
        $base . '/assets/css/legacy-custom.css',
        array(),
        $ver
    );

    wp_enqueue_style(
        'eludein-child-refresh',
        $base . '/assets/css/refresh.css',
        array('eludein-child-legacy'),
        $ver
    );

    wp_enqueue_style(
        'eludein-child-nav',
        $base . '/assets/css/nav.css',
        array('eludein-child-refresh'),
        $ver
    );

    wp_enqueue_style(
        'eludein-child-layout',
        $base . '/assets/css/layout.css',
        array('eludein-child-nav'),
        $ver
    );

    $button_deps = array('eludein-child-layout');
    if (class_exists('WooCommerce')) {
        wp_enqueue_style(
            'eludein-child-woocommerce',
            $base . '/assets/css/woocommerce.css',
            array('eludein-child-layout'),
            $ver
        );
        $button_deps = array('eludein-child-woocommerce');
    }

    wp_enqueue_style(
        'eludein-child-buttons',
        $base . '/assets/css/buttons.css',
        $button_deps,
        $ver
    );

    if (function_exists('is_page') && (is_page('le-tarot-fleur-damours-en-detail') || is_page(592))) {
        wp_enqueue_style(
            'eludein-child-tarot-detail',
            $base . '/assets/css/tarot-detail.css',
            array('eludein-child-buttons'),
            $ver
        );
    }
}
add_action('wp_enqueue_scripts', 'eludein_child_enqueue_styles', 110);

/**
 * Playfair Display pour les titres (déjà utilisé ponctuellement sur le site).
 */
function eludein_child_enqueue_fonts(): void
{
    wp_enqueue_style(
        'eludein-child-fonts',
        'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400&display=swap',
        array(),
        null
    );
}
add_action('wp_enqueue_scripts', 'eludein_child_enqueue_fonts', 5);

/**
 * LiteSpeed UCSS/combine must not swallow the child stylesheets.
 */
function eludein_child_litespeed_css_excludes($excludes)
{
    $extra = "eludein-child\nrefresh.css\nnav.css\nlayout.css\nbuttons.css\nlegacy-custom.css\nwoocommerce.css\ntarot-detail.css\neludein-child-fonts";
    if (is_array($excludes)) {
        return array_merge($excludes, explode("\n", $extra));
    }
    return trim((string) $excludes . "\n" . $extra);
}
add_filter('litespeed_optimize_css_excludes', 'eludein_child_litespeed_css_excludes');
add_filter('litespeed_ucss_file_exc', 'eludein_child_litespeed_css_excludes');

/**
 * Masque les emojis du premier niveau (ils cassent la DA) en les
 * encapsulant ; les sous-menus les gardent, assourdis en CSS.
 */
function eludein_child_wrap_menu_emoji($title, $item = null, $args = null, $depth = 0)
{
    if (!is_string($title) || $title === '') {
        return $title;
    }

    $wrapped = preg_replace(
        '/^(\s*)((?:[\x{1F000}-\x{1FFFF}\x{2600}-\x{27BF}\x{FE0F}\x{200D}\x{20E3}]+)+)(\s*)/u',
        '$1<span class="eludein-menu-emoji" aria-hidden="true">$2</span>$3',
        $title,
        1
    );

    return is_string($wrapped) ? $wrapped : $title;
}
add_filter('nav_menu_item_title', 'eludein_child_wrap_menu_emoji', 10, 4);

/**
 * Compte / contact / blog / espace pro : rangée utilitaire.
 */
function eludein_child_mark_utility_nav_items($items, $args)
{
    if (!is_array($items)) {
        return $items;
    }

    foreach ($items as $item) {
        $parent = isset($item->menu_item_parent) ? (int) $item->menu_item_parent : 0;
        if ($parent !== 0) {
            continue;
        }
        $hay = strtolower((string) ($item->url ?? '') . ' ' . wp_strip_all_tags((string) ($item->title ?? '')));
        if (preg_match('/mon-compte|\/contact|category\/blog|espace[- ]pro|espace_pro|\/panier/', $hay)) {
            $item->classes[] = 'eludein-nav-utility';
        }
    }

    return $items;
}
add_filter('wp_nav_menu_objects', 'eludein_child_mark_utility_nav_items', 10, 2);

/**
 * Les blocs Kadence de l’accueil ont des couleurs inline !important
 * (or pâle, gris, blanc) illisibles sur fond crème. On les assombrit
 * à l’affichage, sans modifier la base ni WooCommerce.
 */
function eludein_child_readable_inline_colors($html)
{
    if (!is_string($html) || $html === '') {
        return $html;
    }

    $rewritten = preg_replace_callback(
        '/style=(["\'])([^"\']*)\1/i',
        'eludein_child_rewrite_style_attribute',
        $html
    );

    return is_string($rewritten) ? $rewritten : $html;
}

/**
 * Assombrit les couleurs de texte pâles dans un attribut style.
 * Ne touche pas au texte blanc posé sur un fond or / forêt (CTA).
 *
 * @param array $match
 */
function eludein_child_rewrite_style_attribute($match)
{
    $quote = $match[1];
    $style = $match[2];
    $keep_light_text = (bool) preg_match(
        '/background(?:-color)?:\s*(#e3b15b|#c4923a|#b8873a|#3f4a3a|#243028|#111|#000|#1a1f18|#1a1816)/i',
        $style
    );

    if (!$keep_light_text) {
        $style = preg_replace(
            '/(?<!-)color:\s*(#ffffff|#fefefe|#fff)(\s*!important)?/i',
            'color: #243028$2',
            $style
        ) ?? $style;
    }

    $style = preg_replace(
        '/(?<!-)color:\s*(#f0c3c3|#eabebe|#f2c2c2|#e3b15b|#e9c764|#fdd888|#f2ca8e|#d1d1d1|#cccccc|#eeeeee|#dddddd|#777777|#999999|#ccc|#eee|#ddd|#777|#999)(\s*!important)?/i',
        'color: #1a1816$2',
        $style
    ) ?? $style;

    $style = preg_replace_callback(
        '/font-size:\s*(\d+(?:\.\d+)?)px(\s*!important)?/i',
        'eludein_child_bump_inline_font_size',
        $style
    ) ?? $style;

    return 'style=' . $quote . $style . $quote;
}
add_filter('the_content', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_text', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_block_content', 'eludein_child_readable_inline_colors', 20);

/**
 * Kadence pose des font-size:16px trop petites à 100 % sur grand écran.
 *
 * @param array $match
 */
function eludein_child_bump_inline_font_size($match): string
{
    $px = (float) $match[1];
    $imp = $match[2] ?? '';

    if ($px > 0 && $px < 14) {
        $px = 16;
    } elseif ($px < 17) {
        $px = 19;
    } elseif ($px < 20) {
        $px = 21;
    } elseif ($px < 26) {
        $px = 30;
    } elseif ($px < 34) {
        $px = 38;
    } elseif ($px < 44) {
        $px = 50;
    }

    $out = (string) (int) round($px);

    return 'font-size: ' . $out . 'px' . $imp;
}

/**
 * Boutons or = CTA accent. Boutons forêt = pastille outline.
 */
function eludein_child_mark_content_buttons($html)
{
    if (!is_string($html) || $html === '') {
        return $html;
    }

    $rewritten = preg_replace_callback(
        '/<(a|button)([^>]*class="[^"]*(?:wp-block-button__link|kt-button|kb-button|wp-element-button)[^"]*"[^>]*)>/i',
        'eludein_child_mark_one_button_tag',
        $html
    );

    return is_string($rewritten) ? $rewritten : $html;
}

/**
 * @param array $match
 */
function eludein_child_mark_one_button_tag($match)
{
    $tag = $match[0];
    $is_gold = (bool) preg_match('/background(?:-color)?:\s*(#e3b15b|#c4923a|#e9c764|#d4a017|#c9a14a)/i', $tag);

    if ($is_gold && strpos($tag, 'eludein-cta') === false) {
        $tag = preg_replace('/class="/', 'class="eludein-cta ', $tag, 1) ?? $tag;
    }

    if (strpos($tag, 'eludein-cta') === false) {
        $tag = preg_replace('/background(?:-color)?:\s*(#3f4a3a|#243028|#2a3227|#111|#000)(\s*!important)?;?/i', '', $tag) ?? $tag;
        $tag = preg_replace('/(?<!-)color:\s*#(?:fff|ffffff)(\s*!important)?;?/i', '', $tag) ?? $tag;
    }

    return $tag;
}
add_filter('the_content', 'eludein_child_mark_content_buttons', 21);
add_filter('widget_block_content', 'eludein_child_mark_content_buttons', 21);

/**
 * Le CSS additionnel du Personnaliser charge après les feuilles du child
 * et force encore color:#e9c764 !important sur les titres boutique.
 */
function eludein_child_filter_custom_css($css)
{
    if (!is_string($css) || $css === '') {
        return $css;
    }

    $css = preg_replace('/(?<!-)color:\s*#e9c764\s*!important/i', 'color: #243028 !important', $css) ?? $css;
    $css = preg_replace('/(?<!-)color:\s*#fdd888\s*!important/i', 'color: #8a6230 !important', $css) ?? $css;
    $css = preg_replace(
        '/#site-header\.medium-header #site-navigation-wrap,#site-header\.medium-header \.oceanwp-mobile-menu-icon\{background-color:#000\}/i',
        '#site-header.medium-header #site-navigation-wrap,#site-header.medium-header .oceanwp-mobile-menu-icon{background-color:#fbf7f1}',
        $css
    ) ?? $css;

    $css = preg_replace('/\.container\{width:2697px\}/i', '.container{width:100%;max-width:1280px}', $css) ?? $css;
    $css = preg_replace(
        '/\.sidebar-main,\.widget-area\{width:22%\s*!important\}/i',
        '.sidebar-main,.widget-area{width:100%!important}',
        $css
    ) ?? $css;
    $css = preg_replace(
        '/\.content-area\{width:78%\s*!important\}/i',
        '.content-area{width:100%!important}',
        $css
    ) ?? $css;

    return $css;
}
add_filter('wp_get_custom_css', 'eludein_child_filter_custom_css');

/**
 * Surcharges tardives : Personnaliser + UCSS ne doivent pas réintroduire
 * l’or pâle ni le bandeau noir.
 */
function eludein_child_late_contrast_css(): void
{
    echo '<style id="eludein-child-contrast">'
        . 'body.oceanwp-theme.woocommerce ul.products li.product h2,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product h2 a,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product li.title h2,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product li.title a,'
        . 'body.oceanwp-theme.woocommerce-page ul.products li.product h2,'
        . 'body.oceanwp-theme.woocommerce-page ul.products li.product h2 a,'
        . 'body.oceanwp-theme li.product h2 a,'
        . 'body.oceanwp-theme .woocommerce-loop-category__title{color:#243028!important;}'
        . 'body.oceanwp-theme.woocommerce ul.products li.product h2 a:hover,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product li.title a:hover,'
        . 'body.oceanwp-theme li.product h2 a:hover{color:#8a6230!important;}'
        . 'body.oceanwp-theme.woocommerce ul.products li.product .category,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product .category a,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product li.category,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product li.category a{color:#8a6230!important;}'
        . '#site-header,#site-header.medium-header,#site-header .top-header-wrap,'
        . '#site-header.medium-header #site-navigation-wrap,'
        . '#site-header.medium-header .oceanwp-mobile-menu-icon{background-color:#fbf7f1!important;}'
        . '#site-header.medium-header .search-toggle-li{display:none!important;}'
        . '.page-header,.centered-page-header{background:#fbf7f1!important;color:#243028!important;}'
        . '.page-header-title{color:#243028!important;}'
        . 'body.oceanwp-theme{font-size:19px!important;line-height:1.72!important;}'
        . '#site-header #site-navigation-wrap .dropdown-menu>li>a,'
        . '#site-header #site-navigation-wrap .dropdown-menu>li>a .text-wrap'
        . '{font-size:16px!important;}'
        . '#site-header #menu-main-menu>.eludein-nav-utility>a,'
        . '#site-header #menu-main-menu>.eludein-nav-utility>a .text-wrap'
        . '{font-size:13.5px!important;}'
        . '.eludein-header-cta{font-size:14.5px!important;}'
        . '.eludein-shop-intro__title{font-size:clamp(2.7rem,3.4vw,3.85rem)!important;}'
        . '.eludein-shop-intro__lead{font-size:1.38rem!important;line-height:1.65!important;}'
        . '.entry-content .wp-block-cover.is-light,.entry-content .wp-block-cover.is-light p,'
        . '.entry-content .wp-block-cover.is-light h1,.entry-content .wp-block-cover.is-light h2,'
        . '.entry-content .wp-block-cover.is-light h3,.entry-content .wp-block-cover.is-light li,'
        . '.entry-content .wp-block-cover.is-light strong{color:#1a1816!important;}'
        . 'body.oceanwp-theme.page.content-max-width .entry .alignfull,'
        . 'body.oceanwp-theme.page.content-full-width .entry .alignfull,'
        . 'body.oceanwp-theme .entry-content .alignfull,body.oceanwp-theme .entry-content .alignwide'
        . '{width:100%!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;left:auto!important;}'
        . '#content-wrap,#primary,.entry-content{overflow-x:clip;}'
        . 'body.has-sidebar #content-wrap.container{display:flex!important;flex-direction:column!important;'
        . 'float:none!important;width:100%!important;max-width:1280px!important;'
        . 'margin-left:auto!important;margin-right:auto!important;}'
        . 'body.has-sidebar #primary,body.has-sidebar .content-area,body.has-sidebar #right-sidebar,'
        . 'body.has-sidebar .widget-area,body.has-sidebar .sidebar-main'
        . '{float:none!important;width:100%!important;max-width:100%!important;border:0!important;}'
        . 'body.woocommerce #right-sidebar,body.woocommerce-page #right-sidebar,'
        . 'body.woocommerce #left-sidebar,body.woocommerce-page #left-sidebar,'
        . 'body.woocommerce-shop #right-sidebar,body.single-product #right-sidebar,'
        . 'body.tax-product_cat #right-sidebar,body.woocommerce-cart #right-sidebar,'
        . 'body.woocommerce-checkout #right-sidebar,body.woocommerce-account #right-sidebar'
        . '{display:none!important;}'
        . 'body.woocommerce-shop .oceanwp-toolbar,.woocommerce .oceanwp-toolbar,'
        . 'body.woocommerce-shop .woocommerce-ordering,body.woocommerce-shop .oceanwp-grid-list,'
        . 'body.woocommerce-shop .result-count,body.woocommerce-shop li.product-category'
        . '{display:none!important;}'
        . 'body.woocommerce-shop ul.products li.product .woo-entry-inner > li.image-wrap,'
        . 'body.woocommerce-shop ul.products li.product .woo-entry-inner > li.image-wrap .woo-entry-image'
        . '{display:block!important;}'
        . 'body.woocommerce-shop ul.products li.product .button,'
        . 'body.woocommerce-page ul.products li.product .button'
        . '{background:linear-gradient(105deg,#b8873a 0%,#e3b15b 40%,#f6e0a8 50%,#e3b15b 60%,#b8873a 100%)!important;'
        . 'color:#1a1816!important;border:1px solid #c9a14a!important;}'
        . '#site-header.medium-header .top-col,#site-header.medium-header #site-logo,'
        . '#site-header.medium-header #site-logo-inner{display:contents!important;float:none!important;}'
        . '#site-header #menu-main-menu > li:hover > ul.sub-menu,'
        . '#site-header #menu-main-menu > li.sfHover > ul.sub-menu'
        . '{display:block!important;visibility:visible!important;opacity:1!important;'
        . 'left:0!important;right:auto!important;transform:none!important;'
        . 'top:calc(100% - 2px)!important;width:28rem!important;min-width:22rem!important;'
        . 'max-width:min(30rem,calc(100vw - 1.5rem))!important;}'
        . '#site-header #menu-main-menu > li.menu-item-has-children:has(+ .eludein-nav-utility):hover > ul.sub-menu,'
        . '#site-header #menu-main-menu > li.menu-item-has-children:has(+ .eludein-nav-utility).sfHover > ul.sub-menu'
        . '{left:auto!important;right:0!important;}'
        . '#site-header .dropdown-menu .sub-menu li,#site-header .dropdown-menu .sub-menu a,'
        . '#site-header .dropdown-menu .sub-menu a .text-wrap'
        . '{width:100%!important;white-space:normal!important;overflow-wrap:break-word!important;word-break:normal!important;}'
        . '</style>' . "\n";
}
add_action('wp_head', 'eludein_child_late_contrast_css', 9999);

/**
 * Le logo header ne doit pas rester un placeholder LiteSpeed.
 */
function eludein_child_litespeed_lazy_excludes($excludes)
{
    $extra = "custom-logo\nChatGPT-Image-20-nov\nwoo-entry-image-main\nwp-content/uploads";
    if (is_array($excludes)) {
        return array_merge($excludes, explode("\n", $extra));
    }
    return trim((string) $excludes . "\n" . $extra);
}
add_filter('litespeed_media_lazy_img_excludes', 'eludein_child_litespeed_lazy_excludes');

function eludein_child_logo_skip_lazy(array $attr): array
{
    $class = (string) ($attr['class'] ?? '');
    $is_logo = strpos($class, 'custom-logo') !== false;
    $is_content_photo = (
        strpos($class, 'woo-entry-image-main') !== false
        || strpos($class, 'wp-post-image') !== false
        || strpos($class, 'wp-image-') !== false
    );

    if ($is_logo || $is_content_photo) {
        $attr['data-no-lazy'] = '1';
        $attr['data-skip-lazy'] = '1';
        $attr['loading'] = 'eager';
        if ($is_logo) {
            $attr['fetchpriority'] = 'high';
        }
    }
    return $attr;
}
add_filter('wp_get_attachment_image_attributes', 'eludein_child_logo_skip_lazy', 20);

/**
 * Gutenberg stocke les <img> en HTML : LiteSpeed les lazy-load hors du filtre d’attributs.
 * On rétablit le vrai src si un placeholder SVG a déjà été injecté.
 */
function eludein_child_content_images_skip_lazy($html)
{
    if (!is_string($html) || $html === '') {
        return $html;
    }

    $rewritten = preg_replace_callback(
        '/<img\b[^>]*>/i',
        'eludein_child_unwrap_one_lazy_img',
        $html
    );

    return is_string($rewritten) ? $rewritten : $html;
}

/**
 * @param array $match
 */
function eludein_child_unwrap_one_lazy_img($match): string
{
    $tag = $match[0];
    if (preg_match('/data-src="(https?:\/\/[^"]+)"/i', $tag, $src)) {
        $real = $src[1];
        if (preg_match('/\ssrc="data:image\/svg\+xml[^"]*"/i', $tag)) {
            $tag = preg_replace('/\ssrc="data:image\/svg\+xml[^"]*"/i', ' src="' . $real . '"', $tag, 1) ?? $tag;
        }
    }
    if (strpos($tag, 'data-no-lazy') === false) {
        $tag = preg_replace('/\s*\/?>$/', ' data-no-lazy="1" data-skip-lazy="1" loading="eager">', $tag, 1) ?? $tag;
    }

    return $tag;
}
add_filter('the_content', 'eludein_child_content_images_skip_lazy', 999);
add_filter('widget_block_content', 'eludein_child_content_images_skip_lazy', 999);

/**
 * Un CTA de chaque côté du logo (boutique / application).
 */
function eludein_child_header_cta_markup(string $which): string
{
    if ($which === 'shop') {
        return '<a class="eludein-header-cta eludein-header-cta--shop eludein-cta" href="'
            . esc_url(home_url('/boutique/'))
            . '">Acheter le tarot Fleur d\'Amours</a>';
    }

    return '<a class="eludein-header-cta eludein-header-cta--app" href="https://app-fleurdamours.eludein.art/jardin" target="_blank" rel="noopener noreferrer">Découvrez en exclusivité l\'application Fleur d\'Åmõürs</a>';
}

function eludein_child_wrap_logo_with_ctas($html)
{
    if (!is_string($html) || $html === '' || is_admin()) {
        return $html;
    }

    return eludein_child_header_cta_markup('shop') . $html . eludein_child_header_cta_markup('app');
}
add_filter('get_custom_logo', 'eludein_child_wrap_logo_with_ctas', 20);

/**
 * Boutique : intro au-dessus de la grille (hook Woo, pas un template).
 */
function eludein_child_shop_intro(): void
{
    if (!function_exists('is_shop') || !is_shop()) {
        return;
    }

    echo '<header class="eludein-shop-intro">'
        . '<p class="eludein-shop-intro__kicker">La boutique</p>'
        . '<h1 class="eludein-shop-intro__title">Quand ça devient illisible, il faut une cartographie</h1>'
        . '<p class="eludein-shop-intro__lead">Le Tarot Fleur d’ÅmÔurs ne prédit pas l’avenir. '
        . 'C’est une boussole systémique&nbsp;: il décrit où ça circule, où ça bloque, où ça se répète — '
        . 'vers soi, vers l’autre, vers le monde — pour que vous repreniez la main sur vos choix.</p>'
        . '<p class="eludein-shop-intro__lead">La séance d’orientation, c’est le même geste, avec moi&nbsp;: '
        . 'clarifier une trajectoire, poser une structure, rétablir la circulation.</p>'
        . '</header>';
}
add_action('woocommerce_archive_description', 'eludein_child_shop_intro', 20);

/**
 * OceanWP colle les paragraphes du résumé sans espace (« visioconférence.Un »).
 */
function eludein_child_shop_loop_description($html)
{
    if (!is_string($html) || $html === '') {
        return $html;
    }
    if (!function_exists('is_shop') || !(is_shop() || (function_exists('is_product_taxonomy') && is_product_taxonomy()))) {
        return $html;
    }

    $plain = wp_strip_all_tags($html);
    $plain = preg_replace('/\.(\S)/u', '. $1', $plain) ?? $plain;
    $plain = preg_replace('/\s+/u', ' ', $plain) ?? $plain;

    return trim($plain);
}
add_filter('woocommerce_short_description', 'eludein_child_shop_loop_description', 20);

/**
 * La boutique n’affiche que les produits, pas les cartes de catégories.
 * Front-office uniquement : l’option WooCommerce en admin reste inchangée.
 */
function eludein_child_shop_products_only($pre)
{
    if (is_admin()) {
        return $pre;
    }

    return '';
}
add_filter('pre_option_woocommerce_shop_page_display', 'eludein_child_shop_products_only');

/**
 * Titres de boucle sans emoji (la DA du salon, pas le contenu WP).
 */
function eludein_child_plain_product_title($title, $post_id = 0)
{
    if (!is_string($title) || $title === '' || is_admin()) {
        return $title;
    }
    if (!function_exists('is_shop') || !(is_shop() || is_product_taxonomy())) {
        return $title;
    }
    if (!in_the_loop()) {
        return $title;
    }
    if ($post_id && get_post_type((int) $post_id) !== 'product') {
        return $title;
    }

    $clean = preg_replace('/[\x{FE0F}\x{200D}\x{20E3}]/u', '', $title) ?? $title;
    $clean = preg_replace('/[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]/u', '', $clean) ?? $clean;
    $clean = preg_replace('/\s+/u', ' ', $clean) ?? $clean;

    return trim($clean);
}
add_filter('the_title', 'eludein_child_plain_product_title', 20, 2);

/**
 * Masque tri / grille OceanWP sur la boutique, sans toucher aux templates Woo.
 */
function eludein_child_shop_declutter(): void
{
    if (!function_exists('is_shop') || !(is_shop() || (function_exists('is_product_taxonomy') && is_product_taxonomy()))) {
        return;
    }

    remove_action('woocommerce_before_shop_loop', 'woocommerce_catalog_ordering', 30);
    remove_action('woocommerce_before_shop_loop', 'woocommerce_result_count', 20);
}
add_action('wp', 'eludein_child_shop_declutter');

function eludein_child_is_tarot_detail_page(): bool
{
    return function_exists('is_page')
        && (is_page('le-tarot-fleur-damours-en-detail') || is_page(592));
}

/**
 * Dossier tarot : retirer les sauts forcés, grouper le héro, soigner la lecture.
 */
function eludein_child_tarot_detail_content($html)
{
    if (!is_string($html) || $html === '' || !eludein_child_is_tarot_detail_page()) {
        return $html;
    }

    $html = preg_replace('#<p(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*/?>)*\s*</p>#i', '', $html) ?? $html;
    $html = preg_replace('#<h([1-6])(?:\s[^>]*)?>\s*(?:&nbsp;|\s)*\s*</h\1>#i', '', $html) ?? $html;
    $html = preg_replace('#<br\s*/?>#i', ' ', $html) ?? $html;
    $html = preg_replace('/[ \t]{2,}/', ' ', $html) ?? $html;

    $html = str_replace(
        'https://eludein.art/produit/prevente-tarot-fleur-damours-edition-dedicacee/',
        home_url('/produit/tarot-fleur-d-amours/'),
        $html
    );

    if (strpos($html, 'eludein-cta') === false) {
        $html = str_replace(
            'class="wp-block-button__link wp-element-button"',
            'class="wp-block-button__link wp-element-button eludein-cta"',
            $html
        );
    }

    if (strpos($html, 'eludein-tarot-hero') === false) {
        $wrapped = preg_replace(
            '#(<h1\b[^>]*>.*?</h1>)(.*?)(<h2\b)#is',
            '<header class="eludein-tarot-hero">'
            . '<p class="eludein-tarot-hero__kicker">Le dossier</p>$1'
            . '<div class="eludein-tarot-hero__stage">$2</div></header>$3',
            $html,
            1
        );
        if (is_string($wrapped)) {
            $html = $wrapped;
        }
    }

    if (strpos($html, 'eludein-tarot-hero__visual') === false) {
        $split = preg_replace_callback(
            '#<div class="eludein-tarot-hero__stage">(.*?)</div></header>#is',
            'eludein_child_split_tarot_hero_stage',
            $html
        );
        if (is_string($split)) {
            $html = $split;
        }
    }

    if (strpos($html, 'eludein-tarot-manifesto') === false) {
        $wrapped = preg_replace(
            '#(<h1\b[^>]*>.*?Bien plus.*?</h1>)#is',
            '<div class="eludein-tarot-manifesto">$1</div>',
            $html,
            1
        );
        if (is_string($wrapped)) {
            $html = $wrapped;
        }
    }

    return $html;
}
add_filter('the_content', 'eludein_child_tarot_detail_content', 24);

/**
 * @param array $match
 */
function eludein_child_split_tarot_hero_stage($match): string
{
    $inner = $match[1];
    if (!preg_match('#(<div class="wp-block-image"[\s\S]*?</figure>\s*</div>)#i', $inner, $img)) {
        return $match[0];
    }

    $lead = str_replace($img[1], '', $inner);

    return '<div class="eludein-tarot-hero__stage"><div class="eludein-tarot-hero__visual">'
        . $img[1]
        . '</div><div class="eludein-tarot-hero__lead">'
        . $lead
        . '</div></div></header>';
}

