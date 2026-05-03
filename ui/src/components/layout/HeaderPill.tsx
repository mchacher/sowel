import type { ReactNode } from "react";

/**
 * Compact tappable pill in the top header. Carries an icon + optional
 * count. Mirrors the existing plugin-updates pill style so the row of
 * indicators stays visually consistent.
 *
 * Tone:
 *   - "error"    → red    (one-or-more system errors require attention)
 *   - "warning"  → amber  (degraded state, not blocking)
 *   - "info"     → primary (info / action available, not negative)
 *   - "neutral"  → muted  (low-importance, e.g. read-only marker)
 */
type Tone = "error" | "warning" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  error: "bg-error/10 text-error hover:bg-error/20",
  warning: "bg-warning/10 text-warning hover:bg-warning/20",
  info: "bg-primary/10 text-primary hover:bg-primary/20",
  neutral: "bg-border-light text-text-secondary hover:bg-border",
};

interface HeaderPillProps {
  icon: ReactNode;
  count?: number;
  label?: string;
  tone: Tone;
  title?: string;
  onClick?: () => void;
  href?: string;
  pulse?: boolean;
}

export function HeaderPill({
  icon,
  count,
  label,
  tone,
  title,
  onClick,
  href,
  pulse,
}: HeaderPillProps) {
  const content = (
    <span
      className={`flex items-center gap-1.5 px-2 py-1 rounded-[6px] transition-colors text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      <span className="relative flex items-center">
        {icon}
        {pulse && (
          <span
            className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
              tone === "error" ? "bg-error" : tone === "warning" ? "bg-warning" : "bg-primary"
            } animate-pulse`}
          />
        )}
      </span>
      {count !== undefined && <span>{count}</span>}
      {label && <span className="hidden sm:inline">{label}</span>}
    </span>
  );

  if (href) {
    // Use a regular anchor — kept dependency-free; callers can swap to NavLink if they need SPA routing.
    return (
      <a href={href} title={title} className="cursor-pointer">
        {content}
      </a>
    );
  }
  return (
    <button onClick={onClick} title={title} type="button" className="cursor-pointer">
      {content}
    </button>
  );
}
