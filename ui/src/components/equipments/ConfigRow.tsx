import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

/**
 * One collapsible row of the equipment page's Configuration card (spec 196,
 * decision pr9-config): the setting's name and a one-line summary of where it
 * stands (« Commande temporisée · Désactivée »), the form only once opened.
 * Same shape as the card's Appareils / Historique / Liaisons rows.
 */
export function ConfigRow({
  icon: Icon,
  title,
  summary,
  summaryTone = "muted",
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Where the setting stands, read without opening the row. */
  summary?: ReactNode;
  /** `alert` for a state that needs attention (a disarmed shared access). */
  summaryTone?: "muted" | "alert";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
      >
        <Chevron size={14} strokeWidth={1.5} className="text-text-tertiary shrink-0" />
        <Icon size={14} strokeWidth={1.5} className="text-text-tertiary shrink-0" />
        <span className="text-small font-medium text-text-secondary">{title}</span>
        {summary !== undefined && summary !== null && summary !== "" && (
          <span
            className={`min-w-0 truncate text-micro ${summaryTone === "alert" ? "text-error" : "text-text-tertiary"}`}
          >
            · {summary}
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}
