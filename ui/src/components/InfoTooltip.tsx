import { useId, useState } from "react";
import { CircleHelp, Info } from "lucide-react";

/**
 * Small hover/focus tooltip: an info icon that reveals a short explanation.
 * Tailwind-only, no external dependency. Reveals on hover AND keyboard focus,
 * dismissible with Escape, so it is usable without a mouse. The bubble inverts
 * the ink/background tokens, so it stays readable on a surface card in both
 * themes. Issue #418 — used to document the arbiter's advanced thresholds.
 */
export function InfoTooltip({
  text,
  label,
  help = false,
  align = "center",
}: {
  text: string;
  label?: string;
  /** A « ? » rather than an « i »: the long explanation of a setting (spec 196). */
  help?: boolean;
  /** `start` opens the bubble rightwards, for an icon near the left edge of a phone. */
  align?: "center" | "start";
}) {
  const id = useId();
  const Icon = help ? CircleHelp : Info;
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
        className="text-text-tertiary hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
      >
        <Icon size={13} strokeWidth={1.5} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`absolute bottom-full z-20 mb-1.5 w-52 rounded-md ${align === "start" ? "-left-2" : "left-1/2 -translate-x-1/2"} bg-text px-2.5 py-1.5 text-micro font-normal leading-snug text-background shadow-lg`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
