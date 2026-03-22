import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
import { Home, Layers, LayoutDashboard, LogOut, Menu, Settings, User, Zap, X, Calendar, Plug, Send, Bell, BarChart3, ChevronRight } from "lucide-react";
import { SowelLogo } from "./SowelLogo";
import { OfflineBanner } from "./OfflineBanner";
import { AlarmBanner } from "./AlarmBanner";
import { PluginUpdateBanner } from "./PluginUpdateBanner";
import { InstallPrompt } from "./InstallPrompt";
import { ROOT_ZONE_ID } from "../../lib/constants";
import { useEnergy } from "../../store/useEnergy";
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
        {/* Plugin update banner (admin only) */}
        {user?.role === "admin" && <PluginUpdateBanner />}

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
  const energyAvailable = useEnergy((s) => s.available);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <nav className="flex lg:hidden flex-col border-t border-border bg-surface">
        <div className="flex items-center justify-around min-h-[56px] px-2">
          <MobileNavLink to="/dashboard" label={t("nav.dashboard")} icon={<LayoutDashboard size={18} strokeWidth={1.5} />} />
          <MobileNavLink to="/home" label={t("nav.maison")} icon={<Home size={18} strokeWidth={1.5} />} />
          {energyAvailable && <MobileNavLink to="/energy" label={t("nav.energy")} icon={<Zap size={18} strokeWidth={1.5} />} />}
          <MobileNavLink to="/modes" label={t("nav.modes")} icon={<Layers size={18} strokeWidth={1.5} />} />
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center justify-center py-1 px-3 rounded-[6px] text-[11px] font-medium text-text-secondary"
          >
            <span className="mb-0.5"><Menu size={18} strokeWidth={1.5} /></span>
            <span className="text-[11px]">{t("nav.more", "Plus")}</span>
          </button>
        </div>
        {/* Safe area spacer for iOS PWA home indicator */}
        <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </nav>

      {/* Drawer overlay */}
      {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
    </>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";
  const logout = useAuth((s) => s.logout);

  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Drawer panel — slides up from bottom */}
      <div className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-[14px] max-h-[85vh] overflow-y-auto animate-slide-up">
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        {/* Close button */}
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-[13px] font-semibold text-text-secondary uppercase tracking-wider">{t("nav.more", "Plus")}</span>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-text-tertiary hover:bg-border-light">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-3 pb-4 space-y-1">
          {/* Settings */}
          <DrawerLink icon={<Settings size={18} strokeWidth={1.5} />} label={t("nav.settings")} onClick={() => go("/settings")} />

          {/* Analyse */}
          <DrawerLink icon={<BarChart3 size={18} strokeWidth={1.5} />} label={t("nav.analyse")} onClick={() => go("/analyse")} />

          {/* Admin section */}
          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-2">
                <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{t("nav.administration")}</span>
              </div>
              <DrawerLink icon={<Calendar size={18} strokeWidth={1.5} />} label={t("nav.calendar")} onClick={() => go("/calendar")} />
              <DrawerLink icon={<Plug size={18} strokeWidth={1.5} />} label={t("nav.integrations")} onClick={() => go("/integrations")} />
              <DrawerLink icon={<Send size={18} strokeWidth={1.5} />} label={t("nav.mqttPublishers")} onClick={() => go("/mqtt-publishers")} />
              <DrawerLink icon={<Bell size={18} strokeWidth={1.5} />} label={t("nav.notificationPublishers")} onClick={() => go("/notification-publishers")} />
            </>
          )}

          {/* User / Logout */}
          {user && (
            <>
              <div className="pt-3 mt-2 border-t border-border-light flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-text-secondary">
                  <User size={16} strokeWidth={1.5} />
                  <span className="text-[13px] font-medium">{user.displayName}</span>
                  {user.role === "admin" && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                      {t("auth.admin")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { logout(); onClose(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-text-tertiary hover:bg-border-light text-[12px]"
                >
                  <LogOut size={14} strokeWidth={1.5} />
                  {t("auth.logout")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Safe area spacer */}
        <div className="bg-surface flex-shrink-0" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  );
}

function DrawerLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-[10px] text-text hover:bg-border-light transition-colors duration-150 text-left"
    >
      <span className="text-text-secondary">{icon}</span>
      <span className="text-[14px] font-medium flex-1">{label}</span>
      <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
    </button>
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
