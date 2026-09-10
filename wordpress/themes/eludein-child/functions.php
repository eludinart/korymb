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
