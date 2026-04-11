interface WaterValveIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * Custom Sowel water valve icon — gate valve style.
 * Stroke 1.5, currentColor, no animation. State is conveyed via color (className).
 */
export function WaterValveIcon({
  size = 24,
  strokeWidth = 1.5,
  className,
  title,
}: WaterValveIconProps) {
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
      role={title ? "img" : undefined}
      aria-label={title}
    >
      {/* Pipe body (horizontal) */}
      <rect x="2" y="14" width="20" height="6" rx="1" />
      {/* Left flange */}
      <line x1="4" y1="14" x2="4" y2="20" />
      {/* Right flange */}
      <line x1="20" y1="14" x2="20" y2="20" />
      {/* Valve stem (vertical body) */}
      <rect x="9" y="10" width="6" height="4" />
      {/* Handwheel (top capsule) */}
      <rect x="5" y="6" width="14" height="4" rx="2" />
    </svg>
  );
}
