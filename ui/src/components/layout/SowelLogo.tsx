interface SowelLogoProps {
  size?: number;
  className?: string;
  /** Show "SOWEL" text below the house */
  showText?: boolean;
  /** Animate the face (wink) */
  animated?: boolean;
}

const MID_BLUE = "var(--color-primary-mid)";

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


export function SowelLogo({ size = 32, className = "", showText = false, animated = false }: SowelLogoProps) {
  if (showText) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="25 15 150 190"
        width={size}
        height={size * 1.3}
        fill="none"
        className={className}
      >
        <path
          d="M100 30 L160 90 Q165 95 160 100 L160 150 Q160 158 152 158 L48 158 Q40 158 40 150 L40 100 Q35 95 40 90 Z"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d="M75 115 Q100 140 125 115" fill="none" stroke={MID_BLUE} strokeWidth="6" strokeLinecap="round" />
        {/* Left eye — static */}
        <path d="M78 95 Q83 87 88 95" fill="none" stroke={MID_BLUE} strokeWidth="5" strokeLinecap="round" />
        {/* Right eye — winks */}
        <g transform="translate(117, 91)">
          {animated && <WinkAnimation />}
          <path d="M-5 4 Q0 -4 5 4" fill="none" stroke={MID_BLUE} strokeWidth="5" strokeLinecap="round" />
        </g>
        <text
          x="100"
          y="195"
          textAnchor="middle"
          fontFamily="Nunito, sans-serif"
          fontWeight="800"
          fontSize="24"
          fill="var(--color-primary)"
          letterSpacing="4"
        >
          SOWEL
        </text>
      </svg>
    );
  }

  const MONO = "var(--color-primary)";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="25 15 150 155"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <path
        d="M100 30 L160 90 Q165 95 160 100 L160 150 Q160 158 152 158 L48 158 Q40 158 40 150 L40 100 Q35 95 40 90 Z"
        fill="none"
        stroke={MONO}
        strokeWidth="12"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M75 115 Q100 140 125 115" fill="none" stroke={MONO} strokeWidth="9" strokeLinecap="round" />
      {/* Left eye — static */}
      <path d="M78 95 Q83 87 88 95" fill="none" stroke={MONO} strokeWidth="8" strokeLinecap="round" />
      {/* Right eye — winks */}
      <g transform="translate(117, 91)">
        {animated && <WinkAnimation />}
        <path d="M-5 4 Q0 -4 5 4" fill="none" stroke={MONO} strokeWidth="8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
