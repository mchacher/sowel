import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./Sidebar";
import { ConnectionStatus } from "./ConnectionStatus";
import { SunlightBanner } from "./SunlightBanner";
import { useWebSocket } from "../../store/useWebSocket";
import { useDevices } from "../../store/useDevices";
import { useZones } from "../../store/useZones";
import { useEquipments } from "../../store/useEquipments";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import { Home, Layers, LayoutDashboard, LogOut, Settings, User } from "lucide-react";
import { SowelLogo } from "./SowelLogo";
import { OfflineBanner } from "./OfflineBanner";
import { AlarmBanner } from "./AlarmBanner";
import { InstallPrompt } from "./InstallPrompt";
import { ROOT_ZONE_ID } from "../../lib/constants";
import { getSettings } from "../../api";

export function AppLayout() {
  const { t } = useTranslation();
  const connect = useWebSocket((s) => s.connect);
  const disconnect = useWebSocket((s) => s.disconnect);
  const fetchDevices = useDevices((s) => s.fetchDevices);
  const fetchZones = useZones((s) => s.fetchZones);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const fetchAggregation = useZoneAggregation((s) => s.fetchAggregation);
  const rootAgg = useZoneAggregation((s) => s.data[ROOT_ZONE_ID]);
  const [homeName, setHomeName] = useState("");

  useEffect(() => {
    fetchDevices();
    fetchZones();
    fetchEquipments();
    fetchAggregation();
    connect();
    getSettings().then((s) => setHomeName(s["home.name"] ?? "")).catch(() => {});
    return () => disconnect();
  }, [fetchDevices, fetchZones, fetchEquipments, fetchAggregation, connect, disconnect]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — desktop only (lg: 1024px+, unreachable on phones) */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Safe area spacer for iOS PWA */}
        <div className="header-tint flex-shrink-0" style={{ height: "env(safe-area-inset-top, 0px)" }} />
        {/* Top bar — compact on mobile, full on desktop */}
        <header
          className="flex items-center justify-between min-h-[44px] sm:min-h-[60px] px-4 sm:px-6 border-b border-border header-tint backdrop-blur-sm"
        >
          <div className="flex items-center gap-4">
            {/* Mobile: logo + home name + sunlight */}
            <div className="flex sm:hidden items-center gap-2">
              <SowelLogo size={24} />
              {homeName && (
                <span className="text-[14px] font-semibold text-text truncate max-w-[140px]">{homeName}</span>
              )}
              <SunlightBanner data={rootAgg} compact />
            </div>
            {/* Desktop: home name + sunlight banner */}
            <div className="hidden lg:flex items-center gap-3">
              {homeName && (
                <span className="text-[15px] font-semibold text-text">{homeName}</span>
              )}
              <SunlightBanner data={rootAgg} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionStatus />
            {/* User info — desktop only */}
            {user && (
              <div className="hidden sm:flex items-center gap-2 ml-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-text-secondary">
                  <User size={14} strokeWidth={1.5} />
                  <span className="text-[12px] font-medium">{user.displayName}</span>
                  {user.role === "admin" && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                      {t("auth.admin")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => logout()}
                  className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors duration-150 cursor-pointer"
                  title={t("auth.logout")}
                >
                  <LogOut size={14} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Offline banner */}
        <OfflineBanner />
        {/* System alarm banner */}
        <AlarmBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <MobileNav />
      </div>

      {/* PWA install prompt */}
      <InstallPrompt />
    </div>
  );
}

function MobileNav() {
  const { t } = useTranslation();
  return (
    <nav
      className="flex lg:hidden flex-col border-t border-border bg-surface"
    >
      <div className="flex items-center justify-around min-h-[56px] px-2">
        <MobileNavLink to="/dashboard" label={t("nav.dashboard")} icon={<LayoutDashboard size={18} strokeWidth={1.5} />} />
        <MobileNavLink to="/home" label={t("nav.maison")} icon={<Home size={18} strokeWidth={1.5} />} />
        <MobileNavLink to="/modes" label={t("nav.modes")} icon={<Layers size={18} strokeWidth={1.5} />} />
        <MobileNavLink to="/settings" label={t("nav.settings")} icon={<Settings size={18} strokeWidth={1.5} />} />
      </div>
      {/* Safe area spacer for iOS PWA home indicator */}
      <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
    </nav>
  );
}

function MobileNavLink({ to, label, icon }: { to: string; label: string; icon?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center py-1 px-3 rounded-[6px] text-[11px] font-medium ${
          isActive ? "text-primary" : "text-text-secondary"
        }`
      }
    >
      {icon && <span className="mb-0.5">{icon}</span>}
      <span className="text-[11px]">{label}</span>
    </NavLink>
  );
}
