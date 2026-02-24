interface WinchLogoProps {
  size?: number;
  className?: string;
}

export function WinchLogo({ size = 32, className = "" }: WinchLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="7" className="fill-primary" />
      {/* Winch drum — centered in square */}
      <circle cx="16" cy="16" r="6.5" stroke="white" strokeWidth="2" fill="none" />
      <circle cx="16" cy="16" r="2" fill="white" />
      {/* Handle/crank */}
      <line x1="16" y1="16" x2="23.5" y2="10.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx="23.5" cy="10.5" r="2" fill="white" />
    </svg>
  );
}
