import type { ReactNode } from "react";

interface WidgetCardProps {
  label: string;
  /** Zone qualifier (spec 139) — a second, quieter line under the title. */
  sublabel?: string;
  /** Optional className extension — used by callers that need to layer behavior (cursor, transitions, edit-mode chrome…). */
  className?: string;
  /** Optional click handler — when set, the caller is expected to apply a cursor-pointer class via `className`. */
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Shared dashboard widget shell.
 *
 * Three responsibilities:
 * - Visual chrome (bg, border, radius, padding, fixed responsive height).
 * - Centered title at 17 px, truncated, over an optional zone line.
 * - Vertical flex container for the widget's per-type content.
 *
 * The zone goes on its own line rather than into the title: a card is ~240 px
 * wide, so "Plafonnier — Chambre 1" truncates precisely where it stops being
 * ambiguous. Splitting the two keeps the name readable and the zone legible.
 *
 * Per-type widgets (light, shutter, thermostat, etc.) wrap their content
 * with this component. See specs/098-design-system-dashboard.
 */
export function WidgetCard({
  label,
  sublabel,
  className = "",
  onClick,
  children,
}: WidgetCardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-md p-3 flex flex-col h-[160px] sm:h-[240px] overflow-hidden ${className}`}
      onClick={onClick}
    >
      <div className="mb-2 text-center">
        <span className="block text-[17px] font-semibold text-text truncate leading-tight">
          {label}
        </span>
        {sublabel && (
          <span className="block text-[11px] text-text-tertiary truncate">{sublabel}</span>
        )}
      </div>
      {children}
    </div>
  );
}
