import { NavLink } from "react-router-dom";
import {
  Radio,
  Box,
  Map,
  Plug,
  Settings,
  Shield,
  Home,
  ChevronLeft,
  ChevronRight,
  Layers,
  Calendar,
  ScrollText,
  DatabaseBackup,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarZoneTree } from "./SidebarZoneTree";
import { SidebarModeList } from "./SidebarModeList";
import { WinchLogo } from "./WinchLogo";
import { useAuth } from "../../store/useAuth";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const ADMIN_ITEMS: NavItem[] = [
  { to: "/devices", label: "nav.devices", icon: <Radio size={18} strokeWidth={1.5} /> },
  { to: "/equipments", label: "nav.equipments", icon: <Box size={18} strokeWidth={1.5} /> },
  { to: "/zones", label: "nav.zones", icon: <Map size={18} strokeWidth={1.5} /> },
  { to: "/calendar", label: "nav.calendar", icon: <Calendar size={18} strokeWidth={1.5} /> },
  { to: "/integrations", label: "nav.integrations", icon: <Plug size={18} strokeWidth={1.5} /> },
  { to: "/logs", label: "nav.logs", icon: <ScrollText size={18} strokeWidth={1.5} /> },
  { to: "/backup", label: "nav.backup", icon: <DatabaseBackup size={18} strokeWidth={1.5} /> },
];

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";

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
          <WinchLogo size={32} className="flex-shrink-0" />
          {!collapsed && (
            <span className="font-semibold text-[16px] tracking-[-0.01em] text-text truncate">
              {t("app.name")}
            </span>
          )}
        </div>
      </div>

      {/* Maison section — scrollable */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
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
            title={t("nav.maison")}
          >
            <Home size={20} strokeWidth={1.5} />
          </NavLink>
        ) : (
          <SidebarZoneTree collapsed={collapsed} />
        )}

        {/* Modes section */}
        <div className="mt-3 pt-2 border-t border-border-light">
          {!collapsed && (
            <NavLink
              to="/modes"
              end
              className={() => `flex items-center gap-2 px-3 mb-2 group`}
            >
              {({ isActive }) => (
                <>
                  <Layers size={14} strokeWidth={1.5} className={`transition-colors ${isActive ? "text-primary" : "text-text-tertiary group-hover:text-primary"}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${isActive ? "text-primary" : "text-text-tertiary group-hover:text-primary"}`}>
                    {t("nav.modes")}
                  </span>
                </>
              )}
            </NavLink>
          )}
          {collapsed ? (
            <NavLink
              to="/modes"
              className={({ isActive }) => `
                flex items-center justify-center px-3 py-2.5 rounded-[6px]
                transition-colors duration-150 ease-out
                ${isActive
                  ? "bg-primary-light text-primary font-medium"
                  : "text-text-secondary hover:bg-border-light hover:text-text"
                }
              `}
              title={t("nav.modes")}
            >
              <Layers size={20} strokeWidth={1.5} />
            </NavLink>
          ) : (
            <SidebarModeList collapsed={collapsed} />
          )}
        </div>
      </div>

      {/* Administration section — admin only */}
      {isAdmin && (
        <div className="border-t border-border-light py-2 px-2">
          {!collapsed && (
            <div className="flex items-center gap-2 px-3 mb-1.5">
              <Shield size={14} strokeWidth={1.5} className="text-text-tertiary" />
              <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                {t("nav.administration")}
              </span>
            </div>
          )}
          <nav className="space-y-0.5">
            {ADMIN_ITEMS.map((item) => (
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
                title={collapsed ? t(item.label) : undefined}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-[12px] font-medium">{t(item.label)}</span>}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Réglages section — all users */}
      <div className="border-t border-border-light py-2 px-2">
        <NavLink
          to="/settings"
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
          title={collapsed ? t("nav.settings") : undefined}
        >
          <span className="flex-shrink-0"><Settings size={18} strokeWidth={1.5} /></span>
          {!collapsed && <span className="text-[12px] font-medium">{t("nav.settings")}</span>}
        </NavLink>
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
