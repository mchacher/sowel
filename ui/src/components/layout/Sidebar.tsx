import { NavLink, useLocation } from "react-router-dom";
import {
  Radio,
  Box,
  Map,
  Plug,
  Package,
  Settings,
  Shield,
  Home,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layers,
  Calendar,
  BarChart3,
  ScrollText,
  DatabaseBackup,
  Send,
  Bell,
  LayoutDashboard,
  Zap,
  PlugZap,
  Sun,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SidebarZoneTree } from "./SidebarZoneTree";
import { SidebarModeList } from "./SidebarModeList";
import { SidebarChartList } from "./SidebarChartList";
import { SowelLogo } from "./SowelLogo";
import { useAuth } from "../../store/useAuth";
import { useEnergy } from "../../store/useEnergy";

type SidebarSection = "maison" | "modes" | "analyse" | "energy" | "admin";

const ADMIN_ROUTES = ["/devices", "/equipments", "/zones", "/calendar", "/integrations", "/plugins", "/mqtt-publishers", "/notification-publishers", "/logs", "/backup"];

function getSectionForPath(pathname: string): SidebarSection | null {
  if (pathname.startsWith("/home")) return "maison";
  if (pathname.startsWith("/modes")) return "modes";
  if (pathname.startsWith("/analyse")) return "analyse";
  if (pathname.startsWith("/energy")) return "energy";
  if (ADMIN_ROUTES.some((r) => pathname.startsWith(r))) return "admin";
  return null;
}

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
  { to: "/plugins", label: "nav.plugins", icon: <Package size={18} strokeWidth={1.5} /> },
  { to: "/mqtt-publishers", label: "nav.mqttPublishers", icon: <Send size={18} strokeWidth={1.5} /> },
  { to: "/notification-publishers", label: "nav.notificationPublishers", icon: <Bell size={18} strokeWidth={1.5} /> },
  { to: "/logs", label: "nav.logs", icon: <ScrollText size={18} strokeWidth={1.5} /> },
  { to: "/backup", label: "nav.backup", icon: <DatabaseBackup size={18} strokeWidth={1.5} /> },
];

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";
  const energyAvailable = useEnergy((s) => s.available);
  const hasProduction = useEnergy((s) => s.hasProduction);
  const checkEnergyAvailability = useEnergy((s) => s.checkAvailability);

  // Auto-collapse: only one section expanded at a time
  const [expandedSection, setExpandedSection] = useState<SidebarSection | null>(
    () => getSectionForPath(location.pathname)
  );

  // Auto-update expanded section when route changes (React recommended pattern)
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setExpandedSection(getSectionForPath(location.pathname));
  }

  const toggleSection = (section: SidebarSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  useEffect(() => {
    checkEnergyAvailability();
  }, [checkEnergyAvailability]);

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
        <div className="flex items-center min-w-0">
          <SowelLogo size={40} className="flex-shrink-0" />
          {!collapsed && (
            <span className="font-extrabold text-[18px] tracking-[0.18em] text-primary ml-2.5 mt-1" style={{ fontFamily: "Nunito, sans-serif" }}>
              SOWEL
            </span>
          )}
        </div>
      </div>

      {/* Navigation sections — scrollable */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {/* Dashboard */}
        <div className="mb-1 pb-2 border-b border-border-light">
          {collapsed ? (
            <NavLink
              to="/dashboard"
              className={({ isActive }) => `
                flex items-center justify-center px-3 py-2.5 rounded-[6px]
                transition-colors duration-150 ease-out
                ${isActive
                  ? "bg-primary-light text-primary font-medium"
                  : "text-text-secondary hover:bg-border-light hover:text-text"
                }
              `}
              title={t("nav.dashboard")}
            >
              <LayoutDashboard size={20} strokeWidth={1.5} />
            </NavLink>
          ) : (
            <NavLink
              to="/dashboard"
              className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 min-w-0 rounded-[6px] transition-colors duration-150 ease-out ${isActive ? "bg-primary-light" : "hover:bg-border-light"}`}
            >
              {({ isActive }) => (
                <>
                  <LayoutDashboard size={14} strokeWidth={1.5} className={`transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`}>
                    {t("nav.dashboard")}
                  </span>
                </>
              )}
            </NavLink>
          )}
        </div>

        {/* Maison */}
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
          <>
            {expandedSection === "maison" ? (
              <SidebarZoneTree collapsed={collapsed} />
            ) : (
              <NavLink
                to="/home"
                onClick={(e) => {
                  if (location.pathname.startsWith("/home")) {
                    e.preventDefault();
                    setExpandedSection("maison");
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 w-full rounded-[6px] transition-colors duration-150 ease-out hover:bg-border-light"
              >
                <Home size={14} strokeWidth={1.5} className="text-text-secondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  {t("nav.maison")}
                </span>
                <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
              </NavLink>
            )}
          </>
        )}

        {/* Modes section */}
        <div className="mt-3 pt-2 border-t border-border-light">
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
            <>
              <NavLink
                to="/modes"
                end
                onClick={(e) => {
                  if (location.pathname.startsWith("/modes")) {
                    e.preventDefault();
                    toggleSection("modes");
                  }
                }}
                className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 mb-1 w-full rounded-[6px] transition-colors duration-150 ease-out ${isActive ? "bg-primary-light" : "hover:bg-border-light"}`}
              >
                {({ isActive }) => (
                  <>
                    <Layers size={14} strokeWidth={1.5} className={`transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`} />
                    <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`}>
                      {t("nav.modes")}
                    </span>
                    {expandedSection === "modes" ? (
                      <ChevronDown size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                    ) : (
                      <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                    )}
                  </>
                )}
              </NavLink>
              {expandedSection === "modes" && <SidebarModeList collapsed={collapsed} />}
            </>
          )}
        </div>

        {/* Analyse section */}
        <div className="mt-3 pt-2 border-t border-border-light">
          {collapsed ? (
            <NavLink
              to="/analyse"
              className={({ isActive }) => `
                flex items-center justify-center px-3 py-2.5 rounded-[6px]
                transition-colors duration-150 ease-out
                ${isActive
                  ? "bg-primary-light text-primary font-medium"
                  : "text-text-secondary hover:bg-border-light hover:text-text"
                }
              `}
              title={t("nav.analyse")}
            >
              <BarChart3 size={20} strokeWidth={1.5} />
            </NavLink>
          ) : (
            <>
              <NavLink
                to="/analyse"
                end
                onClick={(e) => {
                  if (location.pathname.startsWith("/analyse")) {
                    e.preventDefault();
                    toggleSection("analyse");
                  }
                }}
                className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 mb-1 w-full rounded-[6px] transition-colors duration-150 ease-out ${isActive ? "bg-primary-light" : "hover:bg-border-light"}`}
              >
                {({ isActive }) => (
                  <>
                    <BarChart3 size={14} strokeWidth={1.5} className={`transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`} />
                    <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`}>
                      {t("nav.analyse")}
                    </span>
                    {expandedSection === "analyse" ? (
                      <ChevronDown size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                    ) : (
                      <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                    )}
                  </>
                )}
              </NavLink>
              {expandedSection === "analyse" && <SidebarChartList collapsed={collapsed} />}
            </>
          )}
        </div>

        {/* Énergie section — visible only when energy data available */}
        {energyAvailable && (
          <div className="mt-3 pt-2 border-t border-border-light">
            {collapsed ? (
              <NavLink
                to="/energy/consumption"
                className={({ isActive }) => `
                  flex items-center justify-center px-3 py-2.5 rounded-[6px]
                  transition-colors duration-150 ease-out
                  ${isActive
                    ? "bg-primary-light text-primary font-medium"
                    : "text-text-secondary hover:bg-border-light hover:text-text"
                  }
                `}
                title={t("nav.energy")}
              >
                <Zap size={20} strokeWidth={1.5} />
              </NavLink>
            ) : (
              <>
                <button
                  onClick={() => toggleSection("energy")}
                  className="flex items-center gap-2 px-3 py-1.5 mb-1 w-full rounded-[6px] transition-colors duration-150 ease-out hover:bg-border-light cursor-pointer"
                >
                  <Zap size={14} strokeWidth={1.5} className={`transition-colors ${location.pathname.startsWith("/energy") ? "text-primary" : "text-text-secondary"}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${location.pathname.startsWith("/energy") ? "text-primary" : "text-text-secondary"}`}>
                    {t("nav.energy")}
                  </span>
                  {expandedSection === "energy" ? (
                    <ChevronDown size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                  ) : (
                    <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                  )}
                </button>
                {expandedSection === "energy" && (
                  <div className="space-y-0.5 pl-2">
                    <NavLink
                      to="/energy/consumption"
                      className={({ isActive }) => `
                        flex items-center gap-2 px-3 py-1.5 rounded-[6px] min-w-0
                        text-[13px] transition-colors duration-150 ease-out
                        ${isActive
                          ? "bg-primary-light text-primary font-medium"
                          : "text-text-secondary hover:bg-border-light hover:text-text"
                        }
                      `}
                    >
                      <PlugZap size={14} strokeWidth={1.5} />
                      {t("nav.energy.consumption")}
                    </NavLink>
                    {hasProduction && (
                      <NavLink
                        to="/energy/production"
                        className={({ isActive }) => `
                          flex items-center gap-2 px-3 py-1.5 rounded-[6px] min-w-0
                          text-[13px] transition-colors duration-150 ease-out
                          ${isActive
                            ? "bg-primary-light text-primary font-medium"
                            : "text-text-secondary hover:bg-border-light hover:text-text"
                          }
                        `}
                      >
                        <Sun size={14} strokeWidth={1.5} />
                        {t("nav.energy.production")}
                      </NavLink>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Administration section — admin only */}
      {isAdmin && (
        <div className="border-t border-border-light py-2 px-2">
          {collapsed ? (
            <NavLink
              to="/devices"
              className={({ isActive }) => `
                flex items-center justify-center px-3 py-2.5 rounded-[6px]
                transition-colors duration-150 ease-out
                ${isActive
                  ? "bg-primary-light text-primary font-medium"
                  : "text-text-secondary hover:bg-border-light hover:text-text"
                }
              `}
              title={t("nav.administration")}
            >
              <Shield size={20} strokeWidth={1.5} />
            </NavLink>
          ) : (
            <>
              <button
                onClick={() => toggleSection("admin")}
                className="flex items-center gap-2 px-3 py-1.5 mb-1.5 w-full rounded-[6px] transition-colors duration-150 ease-out hover:bg-border-light cursor-pointer"
              >
                <Shield size={14} strokeWidth={1.5} className={`transition-colors ${ADMIN_ROUTES.some((r) => location.pathname.startsWith(r)) ? "text-primary" : "text-text-secondary"}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${ADMIN_ROUTES.some((r) => location.pathname.startsWith(r)) ? "text-primary" : "text-text-secondary"}`}>
                  {t("nav.administration")}
                </span>
                {expandedSection === "admin" ? (
                  <ChevronDown size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                ) : (
                  <ChevronRight size={12} strokeWidth={1.5} className="ml-auto text-text-tertiary" />
                )}
              </button>
              {expandedSection === "admin" && (
                <nav className="space-y-0.5 pl-2">
                  {ADMIN_ITEMS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `
                        flex items-center gap-3 px-3 py-1.5 rounded-[6px]
                        transition-colors duration-150 ease-out
                        ${
                          isActive
                            ? "bg-primary-light text-primary font-medium"
                            : "text-text-secondary hover:bg-border-light hover:text-text"
                        }
                      `}
                    >
                      <span className="flex-shrink-0">{item.icon}</span>
                      <span className="text-[12px] font-medium">{t(item.label)}</span>
                    </NavLink>
                  ))}
                </nav>
              )}
            </>
          )}
        </div>
      )}

      {/* Réglages — all users */}
      <div className="border-t border-border-light py-2 px-2">
        <NavLink
          to="/settings"
          className={({ isActive }) => `
            flex items-center gap-2 px-3 py-1.5 rounded-[6px]
            transition-colors duration-150 ease-out
            ${collapsed ? "justify-center" : ""}
            ${isActive ? "bg-primary-light" : "hover:bg-border-light"}
          `}
          title={collapsed ? t("nav.settings") : undefined}
        >
          {({ isActive }) => (
            <>
              <Settings size={collapsed ? 18 : 14} strokeWidth={1.5} className={`flex-shrink-0 transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`} />
              {!collapsed && (
                <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${isActive ? "text-primary" : "text-text-secondary"}`}>
                  {t("nav.settings")}
                </span>
              )}
            </>
          )}
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
