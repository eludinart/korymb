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
    $extra = "eludein-child\nrefresh.css\nnav.css\nlayout.css\nbuttons.css\nlegacy-custom.css\nwoocommerce.css\neludein-child-fonts";
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

    return 'style=' . $quote . $style . $quote;
}
add_filter('the_content', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_text', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_block_content', 'eludein_child_readable_inline_colors', 20);

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
        . '.entry-content .wp-block-cover.is-light,.entry-content .wp-block-cover.is-light p,'
        . '.entry-content .wp-block-cover.is-light h1,.entry-content .wp-block-cover.is-light h2,'
        . '.entry-content .wp-block-cover.is-light h3,.entry-content .wp-block-cover.is-light li,'
        . '.entry-content .wp-block-cover.is-light strong{color:#1a1816!important;}'
        . 'body.oceanwp-theme.page.content-max-width .entry .alignfull,'
        . 'body.oceanwp-theme.page.content-full-width .entry .alignfull,'
        . 'body.oceanwp-theme .entry-content .alignfull,body.oceanwp-theme .entry-content .alignwide'
        . '{width:100%!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;left:auto!important;}'
        . '#content-wrap,#primary,.entry-content{overflow-x:clip;max-width:100%;}'
        . '#site-header #site-navigation-wrap .dropdown-menu > li > a{text-transform:none!important;}'
        . '#site-header #menu-main-menu > li:hover > ul.sub-menu,'
        . '#site-header #menu-main-menu > li.sfHover > ul.sub-menu'
        . '{display:block!important;visibility:visible!important;opacity:1!important;left:50%!important;top:calc(100% - 2px)!important;}'
        . '</style>' . "\n";
}
add_action('wp_head', 'eludein_child_late_contrast_css', 9999);

/**
 * Le logo header ne doit pas rester un placeholder LiteSpeed.
 */
function eludein_child_litespeed_lazy_excludes($excludes)
{
    $extra = "custom-logo\nChatGPT-Image-20-nov";
    if (is_array($excludes)) {
        return array_merge($excludes, explode("\n", $extra));
    }
    return trim((string) $excludes . "\n" . $extra);
}
add_filter('litespeed_media_lazy_img_excludes', 'eludein_child_litespeed_lazy_excludes');

function eludein_child_logo_skip_lazy(array $attr): array
{
    $class = (string) ($attr['class'] ?? '');
    if (strpos($class, 'custom-logo') !== false) {
        $attr['data-no-lazy'] = '1';
        $attr['data-skip-lazy'] = '1';
        $attr['loading'] = 'eager';
        $attr['fetchpriority'] = 'high';
    }
    return $attr;
}
add_filter('wp_get_attachment_image_attributes', 'eludein_child_logo_skip_lazy', 20);

