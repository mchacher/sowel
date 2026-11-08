import type React from "react";

/**
 * The segmented control (spec 197, FR-E6.4). One drawing for every "pick one
 * of a few" row: Wh / €, Total / Par usage, the period tabs shared by Energy
 * and Analyse, the forecast window chips. Four styles had grown on the Energy
 * pages alone.
 *
 * Outlined like the other controls (`border border-border`, 6 px), the chosen
 * segment filled in primary with white text. Each segment is a toggle button
 * (`aria-pressed`) with a 44 px tap area on touch screens; the row is a
 * `hit-group` so neighbouring areas never steal a tap. No `overflow-hidden`:
 * it would clip those areas, so the end segments carry the corners instead.
 */
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when the visible label is not enough (« 1 j »). */
  ariaLabel?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  title,
  fill = false,
  className = "",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label?: string;
  disabled?: boolean;
  /** Tooltip on the group, e.g. why it is disabled. */
  title?: string;
  /** Stretch to the parent's width below `sm`, segments sharing it equally. */
  fill?: boolean;
  /** Layout classes from the caller (margins, alignment). */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      title={title}
      className={`hit-group inline-flex border border-border rounded-sm ${
        fill ? "w-full sm:w-auto" : ""
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={selected}
            aria-label={o.ariaLabel}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(o.value);
            }}
            className={`hit-44 px-3 py-1.5 text-caption font-medium text-center whitespace-nowrap transition-colors first:rounded-l-sm last:rounded-r-sm disabled:cursor-not-allowed ${
              fill ? "flex-1 sm:flex-none" : ""
            } ${
              selected
                ? "bg-primary-fill text-white"
                : "bg-surface text-text-secondary hover:bg-border-light hover:text-text disabled:hover:bg-surface disabled:hover:text-text-secondary cursor-pointer"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
