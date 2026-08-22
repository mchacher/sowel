/**
 * Transmission pylon — the grid/mains glyph (spec 157).
 *
 * Single source of truth: Energy · Live's Réseau node and the UPS panel's
 * Secteur node are the same thing seen from two surfaces, so they use the same
 * silhouette rather than each picking a lightning bolt of its own.
 *
 * Silhouette from electricity-svgrepo-com.svg, with the 8 outer "extremity"
 * corners rounded via Q (quadratic Bézier) commands at radius ≈ 25. ViewBox
 * padded ±60 so the icon appears visually lighter, matching the solar panel
 * weight beside it.
 *
 * Colour comes from the parent via `currentColor`.
 */
export function GridPylonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 605 605" fill="currentColor" aria-hidden="true">
      <path d="M 485 141.748 V 101.926 Q 485 76.926 462.075 66.926 L 331.569 10 Q 308.644 0 283.644 0 H 201.356 Q 176.356 0 153.431 10 L 22.925 66.926 Q 0 76.926 0 101.926 V 141.748 H 159.45 L 67.511 455 H 0 V 460 Q 0 485 25 485 H 460 Q 485 485 485 460 V 455 H 417.489 L 325.55 141.748 H 485 Z M 194.485 111.748 V 45 Q 194.485 30 209.485 30 H 275.514 Q 290.514 30 290.514 45 V 111.748 H 194.485 Z M455,111.748H320.515v-73.84L455,96.57V111.748z M30,96.57l134.485-58.663v73.84H30V96.57z M372.125,455h-259.25L242.5,313.804L372.125,455z M262.863,291.624l57.142-62.243l53.706,182.985L262.863,291.624z M111.289,412.366l53.706-182.985l57.142,62.243L111.289,412.366z M310.139,195.766L242.5,269.442l-67.639-73.676l15.854-54.018h103.569L310.139,195.766z" />
    </svg>
  );
}
