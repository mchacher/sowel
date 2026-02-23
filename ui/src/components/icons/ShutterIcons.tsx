interface ShutterIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Shutter position: 0 = fully closed, 100 = fully open. null/undefined = closed. */
  position?: number | null;
}

/**
 * Slat Y positions (4 slats, evenly spaced in the window area y=6–22).
 * They appear top-to-bottom as the shutter closes.
 */
const SLAT_Y = [9.2, 12.4, 15.6, 18.8];

/** Map a position (0–100) to the number of visible slats (0–4). */
function getSlatsCount(position: number | null | undefined): number {
  if (position === null || position === undefined) return SLAT_Y.length;
  if (position > 80) return 0;  // open
  if (position > 55) return 1;  // ~1/3 closed
  if (position > 35) return 2;  // ~1/2 closed
  if (position > 15) return 3;  // ~2/3 closed
  return 4;                     // closed
}

/** Roller shutter icon with position-aware slats and CSS transitions. */
export function ShutterIcon({ size = 24, strokeWidth = 2, className, position }: ShutterIconProps) {
  const slats = getSlatsCount(position);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Roller box */}
      <rect x="3" y="2" width="18" height="4" rx="1" />
      {/* Window frame */}
      <rect x="3" y="6" width="18" height="16" />
      {/* Slats — opacity transitions animate during movement */}
      {SLAT_Y.map((y, i) => (
        <line
          key={y}
          x1="3" y1={y} x2="21" y2={y}
          style={{ opacity: i < slats ? 1 : 0, transition: "opacity 0.3s ease" }}
        />
      ))}
    </svg>
  );
}

/** Static open icon (convenience wrapper). */
export function ShutterOpenIcon(props: Omit<ShutterIconProps, "position">) {
  return <ShutterIcon {...props} position={100} />;
}

/** Static closed icon (convenience wrapper). */
export function ShutterClosedIcon(props: Omit<ShutterIconProps, "position">) {
  return <ShutterIcon {...props} position={0} />;
}
