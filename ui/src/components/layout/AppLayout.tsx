import { Outlet } from "react-router-dom";
import { useEffect } from "react";
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
import { LogOut, User } from "lucide-react";
import { WinchLogo } from "./WinchLogo";
import { ROOT_ZONE_ID } from "../../lib/constants";

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

  useEffect(() => {
    fetchDevices();
    fetchZones();
    fetchEquipments();
    fetchAggregation();
    connect();
    return () => disconnect();
  }, [fetchDevices, fetchZones, fetchEquipments, fetchAggregation, connect, disconnect]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — hidden on mobile, shown on desktop */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-[60px] px-6 border-b border-border bg-surface/80 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            {/* Mobile logo */}
            <div className="flex md:hidden items-center gap-2">
              <WinchLogo size={28} />
              <span className="font-semibold text-[15px] text-text">{t("app.name")}</span>
            </div>
            {/* Sunlight banner — visible on desktop */}
            <div className="hidden md:block">
              <SunlightBanner data={rootAgg} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionStatus />
            {user && (
              <div className="flex items-center gap-2 ml-2">
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <MobileNav />
      </div>
    </div>
  );
}

function MobileNav() {
  const { t } = useTranslation();
  return (
    <nav className="flex md:hidden items-center justify-around h-[56px] border-t border-border bg-surface px-2">
      <MobileNavLink to="/home" label={t("nav.maison")} active />
      <MobileNavLink to="/devices" label={t("nav.devices")} />
      <MobileNavLink to="/equipments" label={t("nav.equipments")} />
      <MobileNavLink to="/zones" label={t("nav.zones")} />
      <MobileNavLink to="/settings" label={t("nav.settings")} />
    </nav>
  );
}

function MobileNavLink({
  label,
  active,
  disabled,
}: {
  to: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center py-1 px-3 rounded-[6px]
        text-[11px] font-medium
        ${disabled ? "text-text-tertiary opacity-40" : ""}
        ${active ? "text-primary" : "text-text-secondary"}
      `}
    >
      <span className="text-[11px]">{label}</span>
    </div>
  );
}
