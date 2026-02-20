import { NavLink } from "react-router-dom";
import {
  Radio,
  Box,
  Map,
  Workflow,
  Settings,
  Home,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { SidebarZoneTree } from "./SidebarZoneTree";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const SETTINGS_ITEMS: NavItem[] = [
  { to: "/devices", label: "Devices", icon: <Radio size={18} strokeWidth={1.5} /> },
  { to: "/equipments", label: "Equipments", icon: <Box size={18} strokeWidth={1.5} /> },
  { to: "/zones", label: "Home Topology", icon: <Map size={18} strokeWidth={1.5} /> },
  { to: "/scenarios", label: "Scenarios", icon: <Workflow size={18} strokeWidth={1.5} />, disabled: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`
        flex flex-col h-full bg-surface border-r border-border
        transition-all duration-200 ease-out
        ${collapsed ? "w-[68px]" : "w-[260px]"}
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

      {/* Maison section — scrollable */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 mb-2">
            <Home size={14} strokeWidth={1.5} className="text-text-tertiary" />
            <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
              Maison
            </span>
          </div>
        )}
        {collapsed ? (
          <NavLink
            to="/home"
            className={({ isActive }) => `
              flex items-center justify-center px-3 py-2.5 rounded-[6px]
              transition-colors duration-150 ease-out
              ${isActive
                ? "bg-primary-light text-primary font-medium"
                : "text-text-secondary hover:bg-border-light hover:text-text"
              }
            `}
            title="Maison"
          >
            <Home size={20} strokeWidth={1.5} />
          </NavLink>
        ) : (
          <SidebarZoneTree collapsed={collapsed} />
        )}
      </div>

      {/* Settings section — pinned at bottom */}
      <div className="border-t border-border-light py-2 px-2">
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 mb-1.5">
            <Settings size={14} strokeWidth={1.5} className="text-text-tertiary" />
            <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
              Settings
            </span>
          </div>
        )}
        <nav className="space-y-0.5">
          {SETTINGS_ITEMS.map((item) => {
            if (item.disabled) {
              return (
                <div
                  key={item.to}
                  className={`
                    flex items-center gap-3 px-3 py-1.5 rounded-[6px]
                    text-text-tertiary cursor-not-allowed
                    ${collapsed ? "justify-center" : ""}
                  `}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="flex-shrink-0 opacity-40">{item.icon}</span>
                  {!collapsed && (
                    <span className="text-[12px] font-medium opacity-40">{item.label}</span>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-1.5 rounded-[6px]
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
                {!collapsed && <span className="text-[12px] font-medium">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-border-light p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`
            flex items-center justify-center w-full py-2 rounded-[6px]
            text-text-tertiary hover:text-text-secondary hover:bg-border-light
            transition-colors duration-150 ease-out cursor-pointer
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
