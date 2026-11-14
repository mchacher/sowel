import { HOUSE, MASTER, SMALL, SMALL_BELOW_PX, type LogoWeight } from "../../lib/logo";

interface SowelLogoProps {
  size?: number;
  className?: string;
  /** Show "sowel" text below the house */
  showText?: boolean;
  /** Animate the face (wink) */
  animated?: boolean;
}

const INK = "var(--color-primary)";
const FACE = "var(--color-primary-mid)";

/** SVG native wink animation on a single eye */
function WinkAnimation() {
  return (
    <animateTransform
      attributeName="transform"
      additive="sum"
      type="scale"
      values="1 1; 1 1; 1 0.1; 1 1; 1 1"
      keyTimes="0; 0.92; 0.95; 0.98; 1"
      dur="4s"
      repeatCount="indefinite"
    />
  );
}

/** One drawing (spec 210); the weight only changes the strokes and the face placement. */
function Mark({ weight, animated }: { weight: LogoWeight; animated: boolean }) {
  return (
    <>
      <path
        d={HOUSE}
        fill="none"
        stroke={INK}
        strokeWidth={weight.house}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={weight.leftEye}
        fill="none"
        stroke={FACE}
        strokeWidth={weight.eye}
        strokeLinecap="round"
      />
      <g transform={`translate(${weight.wink.origin})`}>
        {animated && <WinkAnimation />}
        <path
          d={weight.wink.path}
          fill="none"
          stroke={FACE}
          strokeWidth={weight.eye}
          strokeLinecap="round"
        />
      </g>
      <path
        d={weight.smilePath}
        fill="none"
        stroke={FACE}
        strokeWidth={weight.smile}
        strokeLinecap="round"
      />
    </>
  );
}

export function SowelLogo({
  size = 32,
  className = "",
  showText = false,
  animated = false,
}: SowelLogoProps) {
  if (showText) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="20 10 160 205"
        width={size}
        height={size * 1.28}
        fill="none"
        className={className}
      >
        <Mark weight={MASTER} animated={animated} />
        <text
          x="100"
          y="200"
          textAnchor="middle"
          fontFamily="Nunito, sans-serif"
          fontWeight="700"
          fontSize="40"
          fill={INK}
          letterSpacing="-0.4"
        >
          sowel
        </text>
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="20 10 160 165"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <Mark weight={size < SMALL_BELOW_PX ? SMALL : MASTER} animated={animated} />
    </svg>
  );
}
