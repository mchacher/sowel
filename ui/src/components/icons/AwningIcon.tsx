interface AwningIconProps {
  size?: number;
  /** "open" = deployed canopy over the window; "closed" = retracted (cassette + small fringe). */
  state?: "open" | "closed";
  /** Stroke width for the window outline. */
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * Awning equipment icon — Sowel palette (primary #1A4F6E + primary-light #E6F0F6).
 * Window outline behind, cassette on top, and either a deployed striped canopy
 * (state="open") or a small retracted fringe (state="closed").
 *
 * Geometry: viewBox 24×24
 *   - Window:       (4, 6) → (20, 20.4)  (h = 14.4)
 *   - Cassette:     (2.5, 3.4) → (21.5, 5.5), rx=0.5
 *   - Canopy top:   x ∈ [3, 21]  at y = 5.5      (narrower — perspective)
 *   - Canopy base:  x ∈ [1.5, 22.5] at y = 10    (wider — overhangs)
 *   - Scallop arc:  r = 1.05, tip at y ≈ 11.05
 *   - 10 alternating dark/light trapezoidal stripes when open.
 */
export function AwningIcon({
  size = 24,
  state = "open",
  strokeWidth = 1.2,
  className,
  title,
}: AwningIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      {/* Window outline (behind everything) */}
      <rect
        x="4" y="6" width="16" height="14.4" rx="0.5"
        fill="none" stroke="#1A4F6E" strokeWidth={strokeWidth} strokeLinejoin="round"
      />

      {state === "open" ? (
        <>
          {/* 10 trapezoidal stripes with scalloped bottom (alternating colors) */}
          <g stroke="none">
            <path d="M 3    5.5 L 4.8  5.5 L 3.6  10 A 1.05 1.05 0 0 1 1.5  10 Z" fill="#1A4F6E" />
            <path d="M 4.8  5.5 L 6.6  5.5 L 5.7  10 A 1.05 1.05 0 0 1 3.6  10 Z" fill="#E6F0F6" />
            <path d="M 6.6  5.5 L 8.4  5.5 L 7.8  10 A 1.05 1.05 0 0 1 5.7  10 Z" fill="#1A4F6E" />
            <path d="M 8.4  5.5 L 10.2 5.5 L 9.9  10 A 1.05 1.05 0 0 1 7.8  10 Z" fill="#E6F0F6" />
            <path d="M 10.2 5.5 L 12   5.5 L 12   10 A 1.05 1.05 0 0 1 9.9  10 Z" fill="#1A4F6E" />
            <path d="M 12   5.5 L 13.8 5.5 L 14.1 10 A 1.05 1.05 0 0 1 12   10 Z" fill="#E6F0F6" />
            <path d="M 13.8 5.5 L 15.6 5.5 L 16.2 10 A 1.05 1.05 0 0 1 14.1 10 Z" fill="#1A4F6E" />
            <path d="M 15.6 5.5 L 17.4 5.5 L 18.3 10 A 1.05 1.05 0 0 1 16.2 10 Z" fill="#E6F0F6" />
            <path d="M 17.4 5.5 L 19.2 5.5 L 20.4 10 A 1.05 1.05 0 0 1 18.3 10 Z" fill="#1A4F6E" />
            <path d="M 19.2 5.5 L 21   5.5 L 22.5 10 A 1.05 1.05 0 0 1 20.4 10 Z" fill="#E6F0F6" />
          </g>
          {/* Cassette — sits above the stripes */}
          <rect x="2.5" y="3.4" width="19" height="2.1" rx="0.5" fill="#1A4F6E" stroke="none" />
        </>
      ) : (
        <>
          {/* Small retracted fringe — 8 alternating scallops at the top of the window */}
          <g stroke="none">
            <path d="M 4  6 L 6  6 L 6  6.4 A 1 1 0 0 1 4  6.4 Z" fill="#1A4F6E" />
            <path d="M 6  6 L 8  6 L 8  6.4 A 1 1 0 0 1 6  6.4 Z" fill="#E6F0F6" />
            <path d="M 8  6 L 10 6 L 10 6.4 A 1 1 0 0 1 8  6.4 Z" fill="#1A4F6E" />
            <path d="M 10 6 L 12 6 L 12 6.4 A 1 1 0 0 1 10 6.4 Z" fill="#E6F0F6" />
            <path d="M 12 6 L 14 6 L 14 6.4 A 1 1 0 0 1 12 6.4 Z" fill="#1A4F6E" />
            <path d="M 14 6 L 16 6 L 16 6.4 A 1 1 0 0 1 14 6.4 Z" fill="#E6F0F6" />
            <path d="M 16 6 L 18 6 L 18 6.4 A 1 1 0 0 1 16 6.4 Z" fill="#1A4F6E" />
            <path d="M 18 6 L 20 6 L 20 6.4 A 1 1 0 0 1 18 6.4 Z" fill="#E6F0F6" />
          </g>
          {/* Cassette — rolled-up box at the top of the window */}
          <rect x="3" y="4.4" width="18" height="2" rx="0.5" fill="#1A4F6E" stroke="none" />
        </>
      )}
    </svg>
  );
}
