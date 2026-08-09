import { useLocation } from "react-router-dom";
import {
  Settings,
  Shield,
  Home,
  ChevronLeft,
  ChevronRight,
  Layers,
  BarChart3,
  LayoutDashboard,
  Zap,
  PlugZap,
  Sun,
  Activity,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SidebarZoneTree } from "./SidebarZoneTree";
import { SidebarModeList } from "./SidebarModeList";
import { SidebarChartList } from "./SidebarChartList";
import { SidebarItem } from "./SidebarItem";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarSeparator } from "./SidebarSeparator";
import { SowelLogo } from "./SowelLogo";
import { useAuth } from "../../store/useAuth";
import { useUpdateAvailable } from "../../hooks/useUpdateAvailable";
import { useEnergy } from "../../store/useEnergy";
import { usePluginUpdates } from "./usePluginUpdates";
import { ADMIN_NAV_ITEMS } from "./admin-nav-items";

type SidebarSection = "maison" | "modes" | "analyse" | "energy" | "admin";

const ADMIN_ROUTES = ADMIN_NAV_ITEMS.map((item) => item.to);

function getSectionForPath(pathname: string): SidebarSection | null {
  if (pathname.startsWith("/home")) return "maison";
  if (pathname.startsWith("/modes")) return "modes";
  if (pathname.startsWith("/analyse")) return "analyse";
  if (pathname.startsWith("/energy")) return "energy";
  if (ADMIN_ROUTES.some((r) => pathname.startsWith(r))) return "admin";
  return null;
}

const ICON_SIZE = 16;

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";
  const updateAvailable = useUpdateAvailable();
  const energyAvailable = useEnergy((s) => s.available);
  const hasProduction = useEnergy((s) => s.hasProduction);
  const checkEnergyAvailability = useEnergy((s) => s.checkAvailability);
  const pluginUpdateCount = usePluginUpdates(isAdmin ?? false);

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

  const adminActive = ADMIN_ROUTES.some((r) => location.pathname.startsWith(r));
  const energyActive = location.pathname.startsWith("/energy");
  const modesSubActive = !collapsed && expandedSection === "modes" && location.pathname.startsWith("/modes/");
  const analyseSubActive = !collapsed && expandedSection === "analyse" && location.pathname.startsWith("/analyse/");
  const energySubActive = !collapsed && expandedSection === "energy" && energyActive;
  const adminSubActive = !collapsed && expandedSection === "admin" && adminActive;

  return (
    <aside
      className={`
        flex flex-col h-full bg-surface border-r border-border
        transition-all duration-200 ease-out
        ${collapsed ? "w-[68px]" : "w-[260px]"}
      `}
    >
      {/* Logo area — height aligned with topbar (mock: 49px) */}
      <div className="flex items-center h-[49px] px-4 border-b border-border-light">
        <div className="flex items-center min-w-0">
          <SowelLogo size={40} className="flex-shrink-0" />
          {!collapsed && (
            <span
              className="font-extrabold text-[18px] tracking-[0.18em] text-primary ml-2.5 mt-1"
              style={{ fontFamily: "Nunito, sans-serif" }}
            >
              SOWEL
            </span>
          )}
        </div>
      </div>

      {/* Navigation sections — scrollable */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {/* Dashboard */}
        <SidebarSectionHeader
          to="/dashboard"
          label={t("nav.dashboard")}
          icon={<LayoutDashboard size={ICON_SIZE} strokeWidth={1.5} />}
          collapsed={collapsed}
          title={collapsed ? t("nav.dashboard") : undefined}
        />

        <SidebarSeparator />

        {/* Maison — when expanded and not collapsed, render the zone tree instead */}
        {expandedSection === "maison" && !collapsed ? (
          <SidebarZoneTree collapsed={collapsed} />
        ) : (
          <SidebarSectionHeader
            to="/home"
            label={t("nav.maison")}
            icon={<Home size={ICON_SIZE} strokeWidth={1.5} />}
            collapsed={collapsed}
            expanded={collapsed ? undefined : false}
            title={collapsed ? t("nav.maison") : undefined}
            onClick={(e) => {
              if (location.pathname.startsWith("/home")) {
                e.preventDefault();
                setExpandedSection("maison");
              }
            }}
          />
        )}

        <SidebarSeparator />

        {/* Modes */}
        <SidebarSectionHeader
          to="/modes"
          label={t("nav.modes")}
          icon={<Layers size={ICON_SIZE} strokeWidth={1.5} />}
          collapsed={collapsed}
          end
          subActive={modesSubActive}
          expanded={collapsed ? undefined : expandedSection === "modes"}
          title={collapsed ? t("nav.modes") : undefined}
          onClick={(e) => {
            if (location.pathname.startsWith("/modes")) {
              e.preventDefault();
              toggleSection("modes");
            }
          }}
        />
        {expandedSection === "modes" && !collapsed && <SidebarModeList collapsed={collapsed} />}

        <SidebarSeparator />

        {/* Analyse */}
        <SidebarSectionHeader
          to="/analyse"
          label={t("nav.analyse")}
          icon={<BarChart3 size={ICON_SIZE} strokeWidth={1.5} />}
          collapsed={collapsed}
          end
          subActive={analyseSubActive}
          expanded={collapsed ? undefined : expandedSection === "analyse"}
          title={collapsed ? t("nav.analyse") : undefined}
          onClick={(e) => {
            // Suppress navigation only when we are already on the bare
            // /analyse workspace (no saved-chart sub-route). On a saved-chart
            // route, the click must navigate back to /analyse so the user can
            // create a new chart — otherwise the workspace is unreachable.
            if (location.pathname === "/analyse") {
              e.preventDefault();
              toggleSection("analyse");
            }
          }}
        />
        {expandedSection === "analyse" && !collapsed && <SidebarChartList collapsed={collapsed} />}

        {/* Énergie — visible only when energy data available */}
        {energyAvailable && (
          <>
            <SidebarSeparator />
            <SidebarSectionHeader
              to="/energy/live"
              label={t("nav.energy")}
              icon={<Zap size={ICON_SIZE} strokeWidth={1.5} />}
              collapsed={collapsed}
              active={energyActive}
              subActive={energySubActive}
              expanded={collapsed ? undefined : expandedSection === "energy"}
              title={collapsed ? t("nav.energy") : undefined}
              onClick={(e) => {
                if (location.pathname.startsWith("/energy")) {
                  e.preventDefault();
                  toggleSection("energy");
                }
              }}
            />
            {expandedSection === "energy" && !collapsed && (
              <div className="space-y-0.5 pl-2 mt-1">
                <SidebarItem
                  to="/energy/live"
                  label={t("nav.energy.live")}
                  icon={<Activity size={14} strokeWidth={1.5} />}
                />
                <SidebarItem
                  to="/energy/consumption"
                  label={t("nav.energy.consumption")}
                  icon={<PlugZap size={14} strokeWidth={1.5} />}
                />
                {hasProduction && (
                  <SidebarItem
                    to="/energy/production"
                    label={t("nav.energy.production")}
                    icon={<Sun size={14} strokeWidth={1.5} />}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Administration section — admin only */}
      {isAdmin && (
        <div className="border-t border-border-light py-2 px-2">
          {collapsed ? (
            <SidebarSectionHeader
              to="/devices"
              label={t("nav.administration")}
              icon={<Shield size={ICON_SIZE} strokeWidth={1.5} />}
              collapsed
              active={adminActive}
              title={t("nav.administration")}
            />
          ) : (
            <>
              <SidebarSectionHeader
                label={t("nav.administration")}
                icon={<Shield size={ICON_SIZE} strokeWidth={1.5} />}
                active={adminActive}
                subActive={adminSubActive}
                expanded={expandedSection === "admin"}
                onClick={() => toggleSection("admin")}
              />
              {expandedSection === "admin" && (
                <nav className="space-y-0.5 pl-2 mt-1">
                  {ADMIN_NAV_ITEMS.map((item) => {
                    const showBadge = item.to === "/plugins" && pluginUpdateCount > 0;
                    const Icon = item.icon;
                    return (
                      <SidebarItem
                        key={item.to}
                        to={item.to}
                        label={t(item.labelKey)}
                        icon={
                          <span className="relative">
                            <Icon size={ICON_SIZE} strokeWidth={1.5} />
                            {showBadge && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-error rounded-full" />
                            )}
                          </span>
                        }
                        badge={
                          showBadge ? (
                            <span className="text-[10px] font-medium text-error bg-error/10 px-1.5 py-0.5 rounded-full">
                              {pluginUpdateCount}
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </nav>
              )}
            </>
          )}
        </div>
      )}

      {/* Réglages — all users */}
      <div className="border-t border-border-light py-2 px-2">
        <SidebarSectionHeader
          to="/settings"
          label={t("nav.settings")}
          icon={
            <span className="relative">
              <Settings size={ICON_SIZE} strokeWidth={1.5} />
              {updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-error rounded-full" />
              )}
            </span>
          }
          collapsed={collapsed}
          title={collapsed ? t("nav.settings") : undefined}
        />
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-border-light p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-background transition-colors duration-150 ease-out cursor-pointer"
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
