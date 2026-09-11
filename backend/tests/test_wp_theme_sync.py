from pathlib import Path
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
    assert "eludein_child_shop_products_only" in functions
    assert "eludein-shop-intro" in woo
    assert "li.product-category" in woo
    assert "oceanwp-toolbar" in woo
    assert "linear-gradient(105deg, #b8873a" in woo
    assert "background: var(--eludein-forest, #3f4a3a) !important;" not in woo
    assert "body.woocommerce-shop #right-sidebar" in layout
    assert "woocommerce/*.php" not in "".join(
        p.relative_to(REPO / sync.THEME_REL).as_posix() for p in sync.local_files()
    )


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
    assert "legacy-custom.css" in names
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
    assert not any("wp-admin" in n for n in names)
