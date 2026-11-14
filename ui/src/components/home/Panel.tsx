import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import type { EquipmentFamily } from "../../types";
import { FAMILY_CLASSES } from "../../lib/equipment-family";

/**
 * A Maison panel (Équipements, Comportements, Activité) as slices under a lid
 * (spec 196, slice 7c, decision pr7-panneaux). The lid is a detached slice
 * carrying the title (16 px semibold), the count beside it and the panel's
 * actions; 12 px of page below it; then the body, whose direct children are
 * the slices (`slices` utility in index.css).
 */
export function Panel({
  title,
  count,
  subtitle,
  headerRight,
  className = "",
  children,
}: {
  title: string;
  /** Shown beside the title, 14 px tertiary. Omitted when undefined. */
  count?: number;
  /** A short qualifier after the title (« dernières 24 h »), hidden on narrow screens. */
  subtitle?: ReactNode;
  headerRight?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-3 min-w-0 ${className}`}>
      <div className="panel-lid">
        <h2 className="text-lead font-semibold text-text whitespace-nowrap">{title}</h2>
        {count !== undefined && (
          <span className="text-body font-medium text-text-tertiary tabular-nums">{count}</span>
        )}
        {subtitle && (
          <span className="hidden min-[400px]:inline text-small text-text-tertiary whitespace-nowrap">
            {subtitle}
          </span>
        )}
        {headerRight && (
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">{headerRight}</div>
        )}
      </div>
      <div className="slices">{children}</div>
    </section>
  );
}

/**
 * The header of one slice of a panel body (an equipment section: Éclairages,
 * Énergie…; or Modes, Recettes): icon, label, count at the right, then the
 * slice's own action when it has one. `solo` is a slice with no rows under its
 * header. With a `family` (spec 208) the label and the icon take the family's
 * ink and the icon sits on a square of its pale; without one, text colour.
 */
export function SliceHeader({
  icon,
  label,
  count,
  action,
  solo = false,
  family = null,
}: {
  icon: ReactNode;
  label: string;
  count?: ReactNode;
  action?: ReactNode;
  solo?: boolean;
  family?: EquipmentFamily | null;
}) {
  const tone = family ? FAMILY_CLASSES[family] : null;
  return (
    <div
      className={`flex items-center gap-2 px-[1.1rem] pt-3 ${solo ? "pb-3 min-h-[48px]" : "pb-0.5 min-h-[40px]"}`}
    >
      {tone ? (
        <span
          aria-hidden="true"
          className={`flex-shrink-0 inline-flex items-center justify-center size-6.5 rounded-sm ${tone.tile}`}
        >
          {icon}
        </span>
      ) : (
        <span className="text-text-secondary flex-shrink-0">{icon}</span>
      )}
      <span className={`text-body font-semibold truncate ${tone ? tone.ink : "text-text"}`}>
        {label}
      </span>
      {count !== undefined && (
        <span className="ml-auto text-small font-medium text-text-tertiary tabular-nums whitespace-nowrap">
          {count}
        </span>
      )}
      {action && <div className={count === undefined ? "ml-auto" : ""}>{action}</div>}
    </div>
  );
}

/** The « + » of a slice header (add a mode, add a recipe). */
export function SliceAddButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-6 h-6 inline-flex items-center justify-center rounded-sm border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors duration-150"
    >
      <Plus size={14} strokeWidth={1.5} />
    </button>
  );
}
