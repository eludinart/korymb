/** Grille et halo fixes, derrière le contenu. Le pointeur traverse la couche. */

export default function HudAtmosphere() {
  return (
    <div className="hud-atmosphere" aria-hidden>
      <div className="hud-atmosphere-grid" />
      <div className="hud-atmosphere-glow" />
      <div className="hud-atmosphere-vignette" />
    </div>
  );
}
