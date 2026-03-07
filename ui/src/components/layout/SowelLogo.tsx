interface SowelLogoProps {
  size?: number;
  className?: string;
}

export function SowelLogo({ size = 32, className = "" }: SowelLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="0.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="32" height="32" rx="7" className="fill-primary" />
      {/* Concentric circles with glow diffusion */}
      <circle cx="16" cy="16" r="2.85" fill="white" stroke="white" strokeWidth="0.3" />
      <circle cx="16" cy="16" r="7" stroke="white" strokeWidth="1.5" opacity="0.8" fill="none" filter="url(#glow)" />
      <circle cx="16" cy="16" r="11.5" stroke="white" strokeWidth="1.2" opacity="0.45" fill="none" />
    </svg>
  );
}
