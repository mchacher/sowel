import type { MouseEvent, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SidebarSectionHeaderProps {
  /** Primary route the header links to. If omitted, renders as a non-link <button>. */
  to?: string;
  label: string;
  icon: ReactNode;
  /** Override — am I the active leaf (full pill bg)? Default = NavLink's automatic isActive. */
  active?: boolean;
  /**
   * When true, a sub-item carries the leaf — render the header in "parent" style
   * (primary text + icon, no bg fill). Use this whenever the section is expanded
   * and a deeper route is the current view, so the header and the sub-item don't
   * highlight at the same time.
   */
  subActive?: boolean;
  /** When defined, renders an expand chevron. */
  expanded?: boolean;
  collapsed?: boolean;
  /** Trailing element shown next to (or in place of) the chevron. */
  badge?: ReactNode;
  /** Forwarded to NavLink — disables prefix matching. */
  end?: boolean;
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
}

function headerClasses(isInSection: boolean, isLeaf: boolean, collapsed: boolean): string {
  const base =
    "flex items-center gap-2 px-3 py-1.5 w-full rounded-sm transition-colors duration-150 ease-out";
  const layout = collapsed ? "justify-center" : "";
  const state = isLeaf ? "bg-primary-light" : isInSection ? "" : "hover:bg-background";
  return `${base} ${layout} ${state}`.trim();
}

function labelClasses(isInSection: boolean): string {
  const base = "text-body font-medium transition-colors";
  return `${base} ${isInSection ? "text-primary" : "text-text-secondary"}`;
}

function iconColorClass(isInSection: boolean): string {
  return isInSection ? "text-primary" : "text-text-secondary";
}

interface ContentProps {
  isInSection: boolean;
  collapsed: boolean;
  label: string;
  icon: ReactNode;
  expanded?: boolean;
  badge?: ReactNode;
}

function HeaderContent({ isInSection, collapsed, label, icon, expanded, badge }: ContentProps) {
  return (
    <>
      <span className={`flex-shrink-0 relative ${iconColorClass(isInSection)}`}>{icon}</span>
      {!collapsed && <span className={labelClasses(isInSection)}>{label}</span>}
      {!collapsed && (badge !== undefined || expanded !== undefined) && (
        <span className="ml-auto flex items-center gap-1 flex-shrink-0">
          {badge}
          {expanded !== undefined &&
            (expanded ? (
              <ChevronDown size={12} strokeWidth={1.5} className="text-text-tertiary" />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} className="text-text-tertiary" />
            ))}
        </span>
      )}
    </>
  );
}

export function SidebarSectionHeader({
  to,
  label,
  icon,
  active,
  subActive,
  expanded,
  collapsed = false,
  badge,
  end,
  title,
  onClick,
}: SidebarSectionHeaderProps) {
  function resolveState(navIsActive: boolean) {
    // subActive forces parent style (in-section text/icon, no bg). It wins over
    // the leaf detection because the visible sub-item carries the leaf.
    if (subActive) {
      return { isInSection: true, isLeaf: false };
    }
    const isLeaf = active ?? navIsActive;
    return { isInSection: isLeaf, isLeaf };
  }

  if (to) {
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onClick}
        title={title}
        className={({ isActive: navIsActive }) => {
          const { isInSection, isLeaf } = resolveState(navIsActive);
          return headerClasses(isInSection, isLeaf, collapsed);
        }}
      >
        {({ isActive: navIsActive }) => {
          const { isInSection } = resolveState(navIsActive);
          return (
            <HeaderContent
              isInSection={isInSection}
              collapsed={collapsed}
              label={label}
              icon={icon}
              expanded={expanded}
              badge={badge}
            />
          );
        }}
      </NavLink>
    );
  }

  const { isInSection, isLeaf } = resolveState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${headerClasses(isInSection, isLeaf, collapsed)} cursor-pointer`}
    >
      <HeaderContent
        isInSection={isInSection}
        collapsed={collapsed}
        label={label}
        icon={icon}
        expanded={expanded}
        badge={badge}
      />
    </button>
  );
}
