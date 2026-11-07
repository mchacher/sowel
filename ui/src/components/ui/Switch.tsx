import type React from "react";

/**
 * The on/off switch (spec 196). One drawing for every switch in the app.
 *
 * Off: a pale track with a visible outline and a grey thumb, so an off switch
 * still reads as a control (outline 4.83:1 on white, thumb 3.99:1 on its
 * track; the old borderless track was 1.33:1). On: a primary track with a
 * white thumb. 36 x 20 px drawn, 44 px tap area on touch screens (`hit-44`).
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  title,
  className = "",
}: {
  checked: boolean;
  /** `event` lets a switch inside a clickable card stop the click there. */
  onChange: (next: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Accessible name, when no visible label is tied to the switch. */
  label?: string;
  title?: string;
  /** Layout classes from the caller (grid placement, margins). */
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(e) => onChange(!checked, e)}
      className={`hit-44 relative inline-flex items-center w-9 h-5 px-[1.5px] shrink-0 rounded-full border-[1.5px] transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-default ${
        checked ? "bg-primary border-primary" : "bg-[var(--n-100)] border-text-tertiary"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4 bg-white" : "translate-x-0 bg-text-tertiary"
        }`}
      />
    </button>
  );
}
