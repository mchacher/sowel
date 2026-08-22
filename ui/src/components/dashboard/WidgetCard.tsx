import { useRef, type ReactNode } from "react";

interface WidgetCardProps {
  label: string;
  /** Zone qualifier (spec 139) — a second, quieter line under the title. */
  sublabel?: string;
  /** Optional className extension — used by callers that need to layer behavior (transitions, edit-mode chrome…). */
  className?: string;
  /** Primary action, fired by a click anywhere on the tile that did not start on a nested control. */
  onClick?: () => void;
  children: ReactNode;
}

/** Nested controls own their own clicks: the tile must stay out of their way. */
const CONTROL_SELECTOR = "button, input, select, textarea, a, [role='button'], [role='slider']";

function inControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(CONTROL_SELECTOR);
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
 * With `onClick`, the whole tile becomes the widget's primary action, the way
 * the mobile card has always worked. Two gestures must not trigger it: a click
 * on a nested control, which would fire the action twice, and a slider drag
 * released off its track, whose click event lands on the card because the card
 * is the common ancestor of pointerdown and pointerup.
 * Hence the pointerdown bookkeeping — checking the click target alone misses
 * the second case. Keyboard users keep the nested button; a role="button" here
 * would nest an interactive element inside another one.
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
  const startedInControl = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    startedInControl.current = inControl(e.target);
  };

  const handleClick = (e: React.MouseEvent) => {
    const fromControl = startedInControl.current;
    startedInControl.current = false;
    if (fromControl || inControl(e.target)) return;
    onClick?.();
  };

  return (
    <div
      className={`bg-surface border border-border rounded-md p-3 flex flex-col h-[160px] sm:h-[240px] overflow-hidden ${
        onClick ? "cursor-pointer active:scale-[0.98] transition-transform" : ""
      } ${className}`}
      onPointerDown={onClick ? handlePointerDown : undefined}
      onClick={onClick ? handleClick : undefined}
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
