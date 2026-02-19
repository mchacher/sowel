import { NavLink } from "react-router-dom";
import {
  Radio,
  LayoutDashboard,
  Box,
  Map,
  Workflow,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: <LayoutDashboard size={20} strokeWidth={1.5} />, disabled: true },
  { to: "/devices", label: "Devices", icon: <Radio size={20} strokeWidth={1.5} /> },
  { to: "/equipments", label: "Equipments", icon: <Box size={20} strokeWidth={1.5} />, disabled: true },
  { to: "/zones", label: "Zones", icon: <Map size={20} strokeWidth={1.5} />, disabled: true },
  { to: "/scenarios", label: "Scenarios", icon: <Workflow size={20} strokeWidth={1.5} />, disabled: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`
        flex flex-col h-full bg-surface border-r border-border
        transition-all duration-200 ease-out
        ${collapsed ? "w-[68px]" : "w-[240px]"}
      `}
    >
      {/* Logo area */}
      <div className="flex items-center h-[60px] px-4 border-b border-border-light">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 bg-primary rounded-[6px] flex items-center justify-center">
            <span className="text-white font-semibold text-sm">C</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-[16px] tracking-[-0.01em] text-text truncate">
              Corbel
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          if (item.disabled) {
            return (
              <div
                key={item.to}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-[6px]
                  text-text-tertiary cursor-not-allowed
                  ${collapsed ? "justify-center" : ""}
                `}
                title={collapsed ? item.label : undefined}
              >
                <span className="flex-shrink-0 opacity-40">{item.icon}</span>
                {!collapsed && (
                  <span className="text-[13px] font-medium opacity-40">{item.label}</span>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-[6px]
                transition-colors duration-150 ease-out
                ${collapsed ? "justify-center" : ""}
                ${
                  isActive
                    ? "bg-primary-light text-primary font-medium"
                    : "text-text-secondary hover:bg-border-light hover:text-text"
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="text-[13px] font-medium">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border-light p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`
            flex items-center justify-center w-full py-2 rounded-[6px]
            text-text-tertiary hover:text-text-secondary hover:bg-border-light
            transition-colors duration-150 ease-out
          `}
        >
          {collapsed ? (
            <ChevronRight size={16} strokeWidth={1.5} />
          ) : (
            <ChevronLeft size={16} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </aside>
  );
}
