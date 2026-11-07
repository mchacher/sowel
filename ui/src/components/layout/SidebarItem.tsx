import type { MouseEvent, ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface SidebarItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  collapsed?: boolean;
  /** Optional override — when undefined, falls back to NavLink's automatic isActive. */
  active?: boolean;
  /** Trailing element shown on the right (count, status dot, etc.). */
  badge?: ReactNode;
  /** Forwarded to NavLink — disables prefix matching for "/" or shared root routes. */
  end?: boolean;
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

function itemClasses(isActive: boolean, collapsed: boolean): string {
  const base =
    "flex items-center gap-3 px-3 py-1.5 rounded-sm min-w-0 transition-colors duration-150 ease-out";
  const layout = collapsed ? "justify-center" : "";
  const state = isActive
    ? "bg-primary-light text-primary font-medium"
    : "text-text-secondary hover:bg-background hover:text-text";
  return `${base} ${layout} ${state}`.trim();
}

export function SidebarItem({
  to,
  label,
  icon,
  collapsed = false,
  active,
  badge,
  end,
  title,
  onClick,
}: SidebarItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={title}
      className={({ isActive: navIsActive }) => itemClasses(active ?? navIsActive, collapsed)}
    >
      <span className="flex-shrink-0 relative">{icon}</span>
      {!collapsed && <span className="text-small font-medium truncate">{label}</span>}
      {!collapsed && badge !== undefined && <span className="ml-auto flex-shrink-0">{badge}</span>}
    </NavLink>
  );
}
