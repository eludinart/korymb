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

    if (class_exists('WooCommerce')) {
        wp_enqueue_style(
            'eludein-child-woocommerce',
            $base . '/assets/css/woocommerce.css',
            array('eludein-child-refresh'),
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
    $extra = "eludein-child\nrefresh.css\nlegacy-custom.css\nwoocommerce.css\neludein-child-fonts";
    if (is_array($excludes)) {
        return array_merge($excludes, explode("\n", $extra));
    }
    return trim((string) $excludes . "\n" . $extra);
}
add_filter('litespeed_optimize_css_excludes', 'eludein_child_litespeed_css_excludes');
add_filter('litespeed_ucss_file_exc', 'eludein_child_litespeed_css_excludes');

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

    $map = array(
        'color: #e3b15b !important' => 'color: #243028 !important',
        'color: #E3B15B !important' => 'color: #243028 !important',
        'color: #d1d1d1 !important' => 'color: #1a1816 !important',
        'color: #ccc !important' => 'color: #2a2724 !important',
        'color: #CCCCCC !important' => 'color: #2a2724 !important',
        'color: #777 !important' => 'color: #3a3530 !important',
        'color: #777777 !important' => 'color: #3a3530 !important',
        'color: #999 !important' => 'color: #3a3530 !important',
        'color: #999999 !important' => 'color: #3a3530 !important',
    );
    $html = str_ireplace(array_keys($map), array_values($map), $html);

    return preg_replace(
        '/color:\s*#ffffff\s*!important;\s*font-weight:\s*bold\s*!important;\s*font-size:\s*12px/i',
        'color: #3f4a3a !important; font-weight: bold !important; font-size: 12px',
        $html
    ) ?? $html;
}
add_filter('the_content', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_text', 'eludein_child_readable_inline_colors', 20);
add_filter('widget_block_content', 'eludein_child_readable_inline_colors', 20);

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
        . 'body.oceanwp-theme.woocommerce-page ul.products li.product h2,'
        . 'body.oceanwp-theme.woocommerce-page ul.products li.product h2 a,'
        . 'body.oceanwp-theme li.product h2 a,'
        . 'body.oceanwp-theme .woocommerce-loop-category__title{color:#243028!important;}'
        . 'body.oceanwp-theme.woocommerce ul.products li.product h2 a:hover,'
        . 'body.oceanwp-theme li.product h2 a:hover{color:#8a6230!important;}'
        . 'body.oceanwp-theme.woocommerce ul.products li.product .category,'
        . 'body.oceanwp-theme.woocommerce ul.products li.product .category a{color:#8a6230!important;}'
        . '#site-header,#site-header.medium-header,#site-header .top-header-wrap,'
        . '#site-header.medium-header #site-navigation-wrap,'
        . '#site-header.medium-header .oceanwp-mobile-menu-icon{background-color:#fbf7f1!important;}'
        . '</style>' . "\n";
}
add_action('wp_head', 'eludein_child_late_contrast_css', 120);

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

