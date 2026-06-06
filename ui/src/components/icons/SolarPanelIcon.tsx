interface SolarPanelIconProps {
  /** Pixel size (sets width/height; a sizing className overrides it). */
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * Solar panel equipment icon (spec 125) — line style matching the Sowel logo.
 * A 4×3 panel grid with a small foot/stem. Single source of truth: the same
 * glyph is used for the Energy → Live "Production" node, the solar_panel
 * equipment everywhere (cards, dashboard, detail, zone group), so they stay
 * visually identical.
 *
 * Color comes from the parent via `currentColor` (e.g. `text-primary`).
 */
export function SolarPanelIcon({
  size = 24,
  strokeWidth = 1.5,
  className,
  title,
}: SolarPanelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {/* Panel body — rounded corners (Sowel-logo line style) */}
      <path d="M3.5 5 Q3 5 3 5.5 L3 18.5 Q3 19 3.5 19 L20.5 19 Q21 19 21 18.5 L21 5.5 Q21 5 20.5 5 Z" />
      {/* 3 vertical separators → 4 columns */}
      <line x1="7.5" y1="5" x2="7.5" y2="19" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="16.5" y1="5" x2="16.5" y2="19" />
      {/* 2 horizontal separators → 3 rows */}
      <line x1="3" y1="9.66" x2="21" y2="9.66" />
      <line x1="3" y1="14.33" x2="21" y2="14.33" />
      {/* Small foot/stem under the panel */}
      <line x1="12" y1="19.5" x2="12" y2="21.5" />
    </svg>
  );
}
