import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Filters, buttons, counters. When they do not fit beside the title they wrap to a full-width row under it. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared page header (spec 196, FR-1): title and optional subtitle on the left,
 * actions on the right. The row wraps, so on a phone the actions drop under the
 * title instead of pushing past the screen edge.
 */
export function PageHeader({ title, subtitle, actions, className = "mb-6" }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle !== undefined && subtitle !== null && (
          <p className="text-small text-text-secondary mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex grow sm:grow-0 items-center justify-end gap-3">{actions}</div>}
    </div>
  );
}

interface PageHeaderButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

/**
 * Primary header button. Below 640 px only the icon shows, in a 40×40 button;
 * the label stays as its accessible name.
 */
export function PageHeaderButton({ icon: Icon, label, onClick }: PageHeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center gap-2 w-10 h-10 sm:w-auto sm:h-auto sm:px-4 sm:py-2 shrink-0 text-small font-medium text-white bg-primary-fill rounded-[6px] hover:bg-primary-fill-hover transition-colors duration-150"
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
