interface AwningIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * Custom Sowel awning icon — wall + slanted canopy + support arm.
 * Stroke 1.5, currentColor, no animation. State is conveyed via color (className).
 */
export function AwningIcon({
  size = 24,
  strokeWidth = 1.5,
  className,
  title,
}: AwningIconProps) {
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
      {/* Wall + ceiling mount line */}
      <line x1="3" y1="4" x2="3" y2="20" />
      <line x1="3" y1="4" x2="21" y2="4" />
      {/* Canopy outer slope (top edge) */}
      <line x1="3" y1="8" x2="21" y2="14" />
      {/* Canopy bottom slope (fabric fold) */}
      <line x1="3" y1="12" x2="21" y2="14" />
      {/* Support arm linking wall to canopy tip */}
      <line x1="3" y1="8" x2="21" y2="14" opacity="0" />
      <line x1="6" y1="20" x2="21" y2="14" />
      {/* Fabric stripes */}
      <line x1="9" y1="6.5" x2="8" y2="10" />
      <line x1="14" y1="7.5" x2="13" y2="11" />
      <line x1="18" y1="9" x2="17" y2="12.5" />
    </svg>
  );
}
