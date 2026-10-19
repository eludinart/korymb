from pathlib import Path
import re
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import wp_theme_sync as sync  # noqa: E402
import wp_theme_pack as pack  # noqa: E402


def test_remote_must_end_with_child_theme():
    try:
        sync.assert_safe_remote("/public_html/wp-content/themes/oceanwp")
        assert False, "should reject parent theme"
    except SystemExit:
        pass
    try:
        sync.assert_safe_remote("/public_html/")
        assert False, "should reject root"
    except SystemExit:
        pass
    sync.assert_safe_remote("/public_html/wp-content/themes/eludein-child")
    sync.assert_safe_remote(
        "/home/u945541167/domains/eludein.art/public_html/wp-content/themes/eludein-child"
    )


def test_protocol_from_cfg():
    assert sync.protocol_from_cfg({"protocol": "sftp", "port": 21}) == "sftp"
    assert sync.protocol_from_cfg({"port": 65002}) == "sftp"
    assert sync.protocol_from_cfg({"port": 21, "secure": True}) == "ftps"
    assert sync.protocol_from_cfg({"port": 21, "secure": False}) == "ftp"


def test_child_theme_beats_customizer_gold():
    functions = (REPO / "wordpress/themes/eludein-child/functions.php").read_text(encoding="utf-8")
    woo = (REPO / "wordpress/themes/eludein-child/assets/css/woocommerce.css").read_text(encoding="utf-8")
    refresh = (REPO / "wordpress/themes/eludein-child/assets/css/refresh.css").read_text(encoding="utf-8")
    layout = (REPO / "wordpress/themes/eludein-child/assets/css/layout.css").read_text(encoding="utf-8")
    assert "eludein_child_filter_custom_css" in functions
    assert "eludein_child_late_contrast_css" in functions
    assert "eludein_child_wrap_menu_emoji" in functions
    assert "eludein-nav-utility" in functions
    nav = (REPO / "wordpress/themes/eludein-child/assets/css/nav.css").read_text(encoding="utf-8")
    assert "eludein-nav-utility" in nav
    assert "eludein_child_mark_content_buttons" in functions
    buttons = (REPO / "wordpress/themes/eludein-child/assets/css/buttons.css").read_text(encoding="utf-8")
    assert "eludein-cta" in buttons
    assert "eludein-sheen" in buttons
    assert "top: calc(100% - 2px)" in nav
    assert "li:hover > ul.sub-menu" in nav
    assert "#f0c3c3" in functions
    assert "body.oceanwp-theme.woocommerce ul.products li.product h2 a" in woo
    assert "#243028" in woo
    assert "search-toggle-li" in refresh
    assert "grid-template-columns" in layout
    assert "wp-block-cover.is-light" in layout
    assert "alignfull" in layout
    assert "eludein-shop-intro" in functions
    assert "woo-entry-image-main" in functions
    assert "eludein_child_shop_products_only" in functions
    assert "eludein-shop-intro" in woo
    assert "li.product-category" in woo
    assert "oceanwp-toolbar" in woo
    assert "linear-gradient(105deg, #b8873a" in woo
    assert "background: var(--eludein-forest, #3f4a3a) !important;" not in woo
    assert "woo-entry-inner > li.image-wrap" in woo
    assert "display: none !important" not in woo.split("li.image-wrap")[1][:80]
    assert "order: 3" in woo
    assert "font-size: 1.22rem !important" in woo
    assert "eludein_child_unglue_product_copy" in functions
    assert "woocommerce_product_get_short_description" in functions
    assert "eludein_child_unglue_product_post" in functions
    assert "get_the_excerpt" in functions
    assert "--eludein-radius-card" in refresh
    assert "body.woocommerce-shop #right-sidebar" in layout
    assert "font-size: 22px" in refresh
    assert "max-width: 1040px" in layout
    charter = (REPO / "wordpress/themes/eludein-child/assets/css/charter.css").read_text(
        encoding="utf-8"
    )
    assert "eludein-child-charter" in functions
    assert "eludein_child_charter_late_css" in functions
    assert "eludein_child_prepare_site_content_images" in functions
    assert "eludein_child_strip_gutenberg_thumb_attrs" in functions
    assert "charter.css" in functions
    assert "display: table !important" in charter
    assert "font-size: 22px" in charter
    assert "#right-sidebar .kt-testimonial-title" in layout
    assert "font-size: 18px !important" in layout
    assert "font-size: 26px !important" in layout
    assert "eludein_child_readable_widget_colors" in functions
    assert "#right-sidebar h1" in functions
    assert "#fleur-container img" in charter
    assert "height: 280px !important" in charter
    assert ".shop_table" in charter
    assert "font-size: 16px !important" in nav
    assert "eludein_child_readable_inline_colors" in functions
    assert "eludein_child_readable_widget_colors" in functions
    assert "eludein_child_bump_inline_font_size" in functions
    tarot_css = (REPO / "wordpress/themes/eludein-child/assets/css/tarot-detail.css").read_text(
        encoding="utf-8"
    )
    assert "eludein_child_tarot_detail_content" in functions
    assert "eludein_child_tarot_families_markup" in functions
    assert "eludein_child_tarot_detail_late_css" in functions
    assert "eludein_child_tarot_filename_from_img" in functions
    assert "eludein_child_tarot_prepare_card_img" in functions
    assert "eludein_child_tarot_label_from_html" in functions
    assert "eludein_child_tarot_name_map" in functions
    assert "eludein-tarot-gallery--4" in functions
    assert "white-space: nowrap" not in tarot_css
    assert "eludein-tarot-gallery--4" in tarot_css
    assert "eludein-tarot-gallery--5" in tarot_css
    assert "min-width: 100% !important" in tarot_css
    assert r"(<h1\b[^>]*>\s*Bien plus[\s\S]*?</h1>)" in functions
    assert r"(<h1\b[^>]*>.*?Bien plus.*?</h1>)" not in functions
    assert ".eludein-tarot-families" in tarot_css
    assert ".eludein-tarot-forms" in tarot_css
    assert ".eludein-tarot-manifesto" in tarot_css
    assert "html:has(body.page-id-592)" in tarot_css
    assert "font-size: 22px !important" in tarot_css
    assert "font-size: 1.48rem !important" in tarot_css
    assert "calc(50% - 50vw)" not in tarot_css
    assert "figure.eludein-tarot-gallery:has(tr:nth-child(5))" in tarot_css
    assert "#243028" in tarot_css
    assert (REPO / "wordpress/themes/eludein-child/assets/css/tarot-detail.css").is_file()
    sample = (
        '<h1>Le Tarot Fleur d’ÅmÔurs en détail</h1><p>Intro</p>'
        '<h2>Un système vivant</h2><p>Corps</p>'
        '<h1>Bien plus qu’un jeu-outil</h1>'
    )
    greedy = re.compile(r"(<h1\b[^>]*>.*?Bien plus.*?</h1>)", re.I | re.S)
    tight = re.compile(r"(<h1\b[^>]*>\s*Bien plus[\s\S]*?</h1>)", re.I)
    greedy_hit = greedy.search(sample)
    tight_hit = tight.search(sample)
    assert greedy_hit is not None
    assert "Un système vivant" in greedy_hit.group(1)
    assert tight_hit is not None
    assert "Un système vivant" not in tight_hit.group(1)
    assert tight_hit.group(1).startswith("<h1>Bien plus")
    assert "woocommerce/*.php" not in "".join(
        p.relative_to(REPO / sync.THEME_REL).as_posix() for p in sync.local_files()
    )
    gallery = (
        '<figure class="wp-block-table eludein-tarot-gallery aligncenter">'
        '<table class="has-fixed-layout"><tbody><tr>'
        '<td><figure class="eludein-tarot-card"><img src="x"><figcaption>A</figcaption></figure></td>'
        '<td><figure class="eludein-tarot-card"><img src="y"><figcaption>B</figcaption></figure></td>'
        "</tr></tbody></table></figure>"
    )
    flat_re = re.compile(
        r'<figure class="wp-block-table eludein-tarot-gallery\b[^"]*"[^>]*>\s*'
        r"<table\b[^>]*>[\s\S]*?</table>\s*</figure>",
        re.I,
    )
    cards_re = re.compile(
        r'<figure class="eludein-tarot-card\b[^"]*"[^>]*>[\s\S]*?</figure>', re.I
    )
    gallery_match = flat_re.search(gallery)
    assert gallery_match is not None
    cards = cards_re.findall(gallery_match.group(0))
    assert len(cards) == 2
    label_base = re.sub(r"\.[a-z0-9]+$", "", "la-metamorphose-205x300.png", flags=re.I)
    label_base = re.sub(r"[-\s]?\d+x\d+", "", label_base)
    label_base = re.sub(r"-\d+$", "", label_base)
    assert label_base == "la-metamorphose"
    webp = "storge-205x300.png.webp"
    webp_base = webp.lower()
    for _ in range(3):
        nxt = re.sub(r"\.(png|jpe?g|webp|gif)$", "", webp_base, flags=re.I)
        if nxt == webp_base:
            break
        webp_base = nxt
    webp_base = re.sub(r"[-\s]?\d+x\d+", "", webp_base)
    webp_base = re.sub(r"-\d+$", "", webp_base).strip()
    assert webp_base == "storge"


def test_local_theme_files_exist():
    files = sync.local_files()
    names = {p.name for p in files}
    assert "style.css" in names
    assert "functions.php" in names
    assert "refresh.css" in names
    assert "buttons.css" in names
    assert "nav.css" in names
    assert "layout.css" in names
    assert "woocommerce.css" in names
    assert "tarot-detail.css" in names
    assert "charter.css" in names
    assert "legacy-custom.css" in names
    assert "index.php" not in names
    for path in files:
        rel = path.relative_to(REPO / sync.THEME_REL).as_posix()
        assert "wp-admin" not in rel
        assert "wp-includes" not in rel


def test_pack_builds_zip(tmp_path, monkeypatch):

    monkeypatch.setattr(pack, "OUT_DIR", tmp_path)
    monkeypatch.setattr(pack, "OUT", tmp_path / "eludein-child.zip")
    pack.main()
    z = tmp_path / "eludein-child.zip"
    assert z.is_file() and z.stat().st_size > 100
    import zipfile

    with zipfile.ZipFile(z) as zf:
        names = zf.namelist()
    assert "eludein-child/style.css" in names
    assert "eludein-child/functions.php" in names
    assert "eludein-child/assets/css/charter.css" in names
    assert "eludein-child/index.php" not in names
    assert not any("wp-admin" in n for n in names)
