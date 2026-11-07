import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

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
  warning: "bg-warning/10 text-warning-ink hover:bg-warning/20",
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
  /** In-app route: rendered as a NavLink, so it navigates without reloading the page. */
  href?: string;
}

export function HeaderPill({
  icon,
  count,
  label,
  tone,
  title,
  onClick,
  href,
}: HeaderPillProps) {
  const content = (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors text-caption font-semibold ${TONE_CLASS[tone]}`}
    >
      <span className="flex items-center">{icon}</span>
      {count !== undefined && <span>{count}</span>}
      {label && <span className="hidden sm:inline">{label}</span>}
    </span>
  );

  if (href) {
    return (
      <NavLink to={href} title={title} aria-label={title} className="hit-44 cursor-pointer">
        {content}
      </NavLink>
    );
  }
  return (
    <button onClick={onClick} title={title} aria-label={title} type="button" className="hit-44 cursor-pointer">
      {content}
    </button>
  );
}
