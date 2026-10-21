import { useId } from "react";

interface EvCarGaugeProps {
  /** Battery level 0-100, or null when unknown (the body is drawn empty). */
  level: number | null;
  /** Show the charging bolt on the roof. */
  charging?: boolean;
  /** Pixel width; the height follows the 64:40 viewBox. */
  width?: number;
  /** Colour class for the body (sets `currentColor`), e.g. `text-primary`. */
  className?: string;
}

const BODY =
  "M5 29C5 25 6.5 22.5 10 21.5L14.5 13.5C16 11 18.5 9.5 22 9.5H38C41.5 9.5 44 11 46 13.5L50.5 20.5C55.5 21 59 23.5 59 28V30.5C59 31.7 58 32.5 56.8 32.5H7.2C6 32.5 5 31.7 5 30.5Z";
const GLASS = [
  "M16.5 20.5L20 14.8C20.8 13.7 21.8 13.2 23.2 13.2H29.5V20.5Z",
  "M33 13.2H38C39.4 13.2 40.4 13.8 41.2 14.9L45 20.5H33Z",
];
const WHEELS = [17.5, 46.5];
const BODY_TOP = 9.5;
const BODY_BOTTOM = 32.5;

/**
 * Electric vehicle icon that doubles as its battery gauge (spec 183): the body
 * fills from the bottom as the battery level rises. Cut-outs (glass, wheel
 * arches) take the card surface colour so the fill reads the same on both
 * themes. Colour comes from the parent via `currentColor`.
 */
export function EvCarGauge({ level, charging = false, width = 88, className }: EvCarGaugeProps) {
  const clipId = useId();
  const pct = level === null ? 0 : Math.min(100, Math.max(0, level));
  const fillY = BODY_BOTTOM - ((BODY_BOTTOM - BODY_TOP) * pct) / 100;

  return (
    <svg
      width={width}
      height={(width * 40) / 64}
      viewBox="0 0 64 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y={fillY} width="64" height="40" />
        </clipPath>
      </defs>
      <path d={BODY} fill="currentColor" fillOpacity={0.16} />
      <path d={BODY} fill="currentColor" clipPath={`url(#${clipId})`} />
      <path d={BODY} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      {GLASS.map((d) => (
        <path
          key={d}
          d={d}
          fill="var(--color-surface)"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ))}
      <circle
        cx="55"
        cy="25.5"
        r="2.1"
        fill="var(--color-surface)"
        stroke="currentColor"
        strokeWidth={1}
      />
      <circle cx="55" cy="25.5" r="0.95" fill="var(--color-accent)" />
      {WHEELS.map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="32.5" r="7.3" fill="var(--color-surface)" />
          <circle cx={cx} cy="32.5" r="5.6" fill="var(--color-text)" />
          <circle cx={cx} cy="32.5" r="2.35" fill="var(--color-surface)" />
        </g>
      ))}
      {charging && (
        <g transform="translate(47 0.5) scale(0.62)">
          <circle cx="12" cy="12" r="12.5" fill="var(--color-accent)" />
          <path
            transform="translate(5 5) scale(0.58)"
            fill="var(--color-text)"
            d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
          />
        </g>
      )}
    </svg>
  );
}
