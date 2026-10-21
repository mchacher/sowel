import { useId } from "react";

interface EvCarGaugeProps {
  /** Battery level 0-100, or null when unknown (the body is drawn empty). */
  level: number | null;
  /** From `evGaugeTone`: amber while charging, a red level when low. */
  tone: "charging" | "low" | "ok";
  /** Plugged in: the charging post and its cable are drawn. */
  plugged: boolean;
  /** Pixel width; the height follows the 80:56 viewBox. */
  width?: number;
}

// Side view in a 72-wide drawing space, placed by CAR_TRANSFORM.
const BODY =
  "M9 37Q6.5 37 6.5 34.5V28Q6.5 25 9 23.5L14.5 16Q16 14 18.5 14H38Q41 14 43 16L50 22.5L61 24.5Q66 25.5 66 30V34.5Q66 37 63.5 37H60A7 7 0 0 0 46 37H26A7 7 0 0 0 12 37Z";
const GLASS = [
  "M16 22.5L19.5 17.5Q20.3 16.5 21.5 16.5H32.5V22.5Z",
  "M35.5 16.5H40.5Q41.6 16.5 42.4 17.3L47.6 22.5H35.5Z",
];
const WHEELS = [19, 53];
// The battery fills the lower body, from the sills up to the window line.
const LEVEL_TOP = 22.5;
const LEVEL_BOTTOM = 37;

const CAR_SCALE = 0.88;
const CAR_Y = 8.7;
// Plugged, the car makes room for the post; alone, it sits in the middle.
const CAR_X_PLUGGED = 15.3;
const CAR_X_ALONE = 8.1;
// Charge flap at the rear of the car, in viewBox units.
const PORT_X = CAR_X_PLUGGED + 7 * CAR_SCALE;
const PORT_Y = CAR_Y + 27 * CAR_SCALE;
// The cable sags almost to the ground, into clear space, so it stays visible.
const CABLE = `M9.5 31C13 31 11.5 44 ${(9.5 + PORT_X) / 2} 44C${PORT_X - 2} 44 ${PORT_X - 3.5} ${PORT_Y} ${PORT_X} ${PORT_Y}`;

const BOLT =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

/**
 * Electric vehicle widget icon (spec 183), drawn like the other dashboard
 * icons (WidgetIcons.tsx): thin strokes, soft `currentColor` gradients. The
 * battery rises in the body like the water in WaterHeaterIcon; the charging
 * post and its cable appear only while the car is plugged in.
 *
 * Wider than the 56x56 house icons, so it carries `widget-icon` to get their
 * dark-mode brightening (index.css).
 */
export function EvCarGauge({ level, tone, plugged, width = 171 }: EvCarGaugeProps) {
  const id = useId();
  const bodyGrad = `ev-body-${id}`;
  const glassGrad = `ev-glass-${id}`;
  const levelGrad = `ev-level-${id}`;
  const wheelGrad = `ev-wheel-${id}`;
  const postGrad = `ev-post-${id}`;
  const clip = `ev-clip-${id}`;

  const charging = tone === "charging";
  const levelColor = tone === "low" ? "var(--color-error)" : "currentColor";
  const pct = level === null ? 0 : Math.min(100, Math.max(0, level));
  const levelY = LEVEL_BOTTOM - ((LEVEL_BOTTOM - LEVEL_TOP) * pct) / 100;
  const carX = plugged ? CAR_X_PLUGGED : CAR_X_ALONE;

  return (
    <svg
      width={width}
      height={(width * 56) / 80}
      viewBox="0 0 80 56"
      fill="none"
      aria-hidden="true"
      className={`widget-icon ${charging ? "text-active" : "text-primary"}`}
    >
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={charging ? 0.12 : 0.06} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={charging ? 0.05 : 0.02} />
        </linearGradient>
        <linearGradient id={glassGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={levelGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={levelColor} stopOpacity={charging ? 0.65 : 0.55} />
          <stop offset="100%" stopColor={levelColor} stopOpacity={charging ? 0.45 : 0.36} />
        </linearGradient>
        <linearGradient id={wheelGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={postGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* Ground */}
      <line
        x1="1"
        x2="79"
        y1="47.8"
        y2="47.8"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.18"
        strokeLinecap="round"
      />

      {/* Charging post */}
      {plugged && (
        <g data-testid="ev-charging-post">
          <rect
            x="2.5"
            y="21"
            width="7"
            height="26.5"
            rx="2"
            fill={`url(#${postGrad})`}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeOpacity="0.6"
          />
          <rect
            x="4.2"
            y="24"
            width="3.6"
            height="3.8"
            rx="0.7"
            fill="currentColor"
            opacity={charging ? 0.9 : 0.35}
          />
        </g>
      )}

      <g transform={`translate(${carX} ${CAR_Y}) scale(${CAR_SCALE})`}>
        <path d={BODY} fill={`url(#${bodyGrad})`} />
        {/* Battery level */}
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={levelY} width="72" height="40" fill={`url(#${levelGrad})`} />
          <line
            x1="0"
            x2="72"
            y1={levelY}
            y2={levelY}
            stroke={levelColor}
            strokeWidth="1.1"
            strokeOpacity="0.8"
          />
        </g>
        <path
          d={BODY}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeOpacity={charging ? 0.75 : 0.55}
          strokeLinejoin="round"
        />
        {GLASS.map((d) => (
          <path
            key={d}
            d={d}
            fill={`url(#${glassGrad})`}
            stroke="currentColor"
            strokeWidth="1.1"
            strokeOpacity="0.4"
            strokeLinejoin="round"
          />
        ))}
        <line
          x1="34"
          y1="24.5"
          x2="34"
          y2="34"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeOpacity="0.25"
        />
        <rect x="37" y="26" width="4" height="1.3" rx="0.65" fill="currentColor" opacity="0.35" />
        <ellipse cx="63.4" cy="27.6" rx="1.7" ry="1.1" fill="currentColor" opacity="0.75" />
        <rect x="6.6" y="25.5" width="1.6" height="3" rx="0.6" fill="currentColor" opacity="0.4" />
        {WHEELS.map((cx) => (
          <g key={cx}>
            <circle
              cx={cx}
              cy="38"
              r="5.5"
              fill={`url(#${wheelGrad})`}
              stroke="currentColor"
              strokeWidth="1.4"
              strokeOpacity="0.65"
            />
            <circle cx={cx} cy="38" r="1.8" fill="currentColor" opacity="0.55" />
          </g>
        ))}
      </g>

      {/* Cable, over the car so its plug sits on the charge flap */}
      {plugged && (
        <g data-testid="ev-cable">
          <path
            d={CABLE}
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity="0.85"
            strokeLinecap="round"
          />
          <rect
            x={PORT_X - 1.6}
            y={PORT_Y - 1.7}
            width="3"
            height="3.4"
            rx="0.8"
            fill="currentColor"
            opacity="0.9"
          />
        </g>
      )}

      {charging && (
        <path
          d={BOLT}
          transform="translate(40 2.5) scale(0.45)"
          fill="currentColor"
          opacity="0.9"
        />
      )}
    </svg>
  );
}
