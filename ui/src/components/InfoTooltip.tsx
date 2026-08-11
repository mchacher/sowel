import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * Small hover/focus tooltip: an info icon that reveals a short explanation.
 * Tailwind-only, no external dependency. Reveals on hover AND keyboard focus,
 * dismissible with Escape, so it is usable without a mouse. The bubble inverts
 * the ink/background tokens, so it stays readable on a surface card in both
 * themes. Issue #418 — used to document the arbiter's advanced thresholds.
 */
export function InfoTooltip({ text, label }: { text: string; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="text-text-tertiary hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
      >
        <Info size={13} strokeWidth={1.5} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute bottom-full left-1/2 z-20 mb-1.5 w-52 -translate-x-1/2 rounded-md bg-text px-2.5 py-1.5 text-[11px] font-normal leading-snug text-background shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
