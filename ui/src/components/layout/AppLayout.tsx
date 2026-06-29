import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./Sidebar";
import { ConnectionStatus } from "./ConnectionStatus";
import { SunlightBanner } from "./SunlightBanner";
import { CurrentTimePill } from "./CurrentTimePill";
import { useWebSocket } from "../../store/useWebSocket";
import { useTimezone } from "../../store/useTimezone";
import { useShadowMode } from "../../store/useShadowMode";
import { ShadowBanner } from "./ShadowBanner";
import { useDevices } from "../../store/useDevices";
import { useZones } from "../../store/useZones";
import type { ZoneWithChildren } from "../../types";
import { useEquipments } from "../../store/useEquipments";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import {
  Home,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  User,
  Zap,
  X,
  Calendar,
  Plug,
  Send,
  Bell,
  BarChart3,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Power,
} from "lucide-react";

// Display name → 1-2 uppercase initials for the avatar pill.
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
import { SowelLogo } from "./SowelLogo";
import { OfflineBanner } from "./OfflineBanner";
import { HeaderPill } from "./HeaderPill";
import { AlarmsSheet } from "./AlarmsSheet";
import { UpdatesSheet } from "./UpdatesSheet";
import { useAggregatedIssues } from "./useAggregatedIssues";
import { useUpdateAvailable } from "../../hooks/useUpdateAvailable";
import { usePluginUpdates } from "./usePluginUpdates";
import { InstallPrompt } from "./InstallPrompt";
import { UpdateOverlay } from "../system/UpdateOverlay";
import { HomeSetupWizard } from "../setup/HomeSetupWizard";
import { ROOT_ZONE_ID } from "../../lib/constants";
import { useEnergy } from "../../store/useEnergy";
import { useUiState } from "../../store/useUiState";
import { useModes } from "../../store/useModes";
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
  const pluginUpdateCount = usePluginUpdates(user?.role === "admin");
  const sowelUpdateAvailable = useUpdateAvailable();
  const restartRequired = useWebSocket((s) => s.restartRequired);
  const fetchTimezone = useTimezone((s) => s.fetch);
  const fetchShadowMode = useShadowMode((s) => s.fetch);
  const issues = useAggregatedIssues();
  const [alarmsOpen, setAlarmsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Updates pill: combines Sowel core + plugin updates into a single counter.
  const totalUpdates = pluginUpdateCount + (sowelUpdateAvailable ? 1 : 0);
  // Alarms pill: red when at least one error, amber otherwise.
  const alarmTone = issues.some((i) => i.level === "error") ? "error" : "warning";

  useEffect(() => {
    fetchDevices();
    fetchZones();
    fetchEquipments();
    fetchAggregation();
    fetchTimezone();
    fetchShadowMode();
    connect();
    getSettings()
      .then((s) => setHomeName(s["home.name"] ?? ""))
      .catch(() => {});
    return () => disconnect();
  }, [
    fetchDevices,
    fetchZones,
    fetchEquipments,
    fetchAggregation,
    fetchTimezone,
    fetchShadowMode,
    connect,
    disconnect,
  ]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Spec 124 — full-width shadow-mode stripe above sidebar + content. */}
      <ShadowBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Sidebar — desktop only (lg: 1024px+, unreachable on phones) */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Safe area spacer for iOS PWA */}
        <div
          className="header-tint flex-shrink-0"
          style={{ height: "env(safe-area-inset-top, 0px)" }}
        />
        {/* Top bar — compact on mobile, full on desktop */}
        <header className="flex items-center min-h-[56px] sm:min-h-[49px] px-3 sm:px-6 border-b border-border-light bg-surface gap-2">
          {/* Left: mobile burger (on zone pages) + title+sub (mockup parity), desktop breadcrumb */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <MobileTopbarBurger />
            <div className="sm:hidden flex-1 min-w-0">
              <MobileTopbarTitle homeName={homeName} />
            </div>
            <div className="hidden lg:flex items-center">
              <TopbarBreadcrumb homeName={homeName} />
            </div>
          </div>

          {/* Right: pills (mock order: time → sun → conn → alarm → updates → avatar). */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Time + sun — full pills on desktop */}
            <div className="hidden sm:flex items-center gap-2">
              <CurrentTimePill />
              <SunlightBanner data={rootAgg} />
            </div>
            {/* Time + sun — compact, space-saving variant on mobile (no seconds) */}
            <div className="flex sm:hidden items-center gap-2">
              <SunlightBanner data={rootAgg} compact />
              <CurrentTimePill compact withSeconds={false} />
            </div>
            <ConnectionStatus />
            {issues.length > 0 && (
              <HeaderPill
                icon={<AlertTriangle size={14} strokeWidth={1.5} />}
                count={issues.length}
                tone={alarmTone}
                title={t("alarms.pill.title", { count: issues.length })}
                onClick={() => setAlarmsOpen(true)}
              />
            )}
            {totalUpdates > 0 && (
              <HeaderPill
                icon={<RefreshCw size={14} strokeWidth={1.5} />}
                count={totalUpdates}
                tone="error"
                title={t("updates.pill.title", { count: totalUpdates })}
                onClick={() => setUpdatesOpen(true)}
              />
            )}
            {restartRequired && (
              <HeaderPill
                icon={<Power size={14} strokeWidth={1.5} />}
                tone="info"
                title={t("restart.pill.title")}
                pulse
                href="/settings"
              />
            )}
            {/* User avatar pill — desktop only (matches mock `.topbar__avatar`). */}
            {user && (
              <div className="hidden sm:flex items-center gap-1.5 ml-1">
                <div className="flex items-center gap-1.5 pl-1 pr-2.5 py-[3px] rounded-full bg-[var(--n-50)] border border-border-light">
                  <span className="w-[22px] h-[22px] rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold leading-none">
                    {getInitials(user.displayName)}
                  </span>
                  <span className="text-[12px] font-medium text-text">{user.displayName}</span>
                </div>
                <button
                  onClick={() => logout()}
                  className="p-1.5 rounded-full text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors duration-150 cursor-pointer"
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
        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[var(--n-25)]">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <MobileNav drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} />
      </div>

      {/* PWA install prompt */}
      <InstallPrompt />

      {/* Alarms sheet — opened by the header pill */}
      <AlarmsSheet open={alarmsOpen} onClose={() => setAlarmsOpen(false)} />

      {/* Updates sheet — lists Sowel core + outdated plugins with per-row actions */}
      <UpdatesSheet open={updatesOpen} onClose={() => setUpdatesOpen(false)} />

      {/* First-login Home setup wizard — blocks the UI when home.name is empty.
          Rendered BEFORE UpdateOverlay so that an active restart (e.g. the one
          the wizard itself triggers on submit) visually replaces the wizard
          rather than letting the user see a stale form behind the overlay. */}
      <HomeSetupWizard />

      {/* Self-update overlay (shown during sowel self-update / restart) */}
      <UpdateOverlay />
      </div>
    </div>
  );
}

// Mock parity: text-[.82rem] / n-400 / weight 500 for crumb, n-700 weight 600 for current.
// On /home/:zoneId shows "Home › ... › CurrentZone" (root zone Maison is treated as implicit).
// On other top-level routes shows the localized route name as the current crumb.
function TopbarBreadcrumb({ homeName }: { homeName: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const tree = useZones((s) => s.tree);

  const zoneMatch = location.pathname.match(/^\/home\/([^/]+)/);
  const path = zoneMatch ? buildZonePath(zoneMatch[1], tree) : null;

  const homeLabel = homeName || t("nav.maison");

  if (path && path.length > 0) {
    // Skip root zone "Maison" from crumb — it's redundant with home name.
    const segments = path[0].id === ROOT_ZONE_ID ? path.slice(1) : path;
    if (segments.length === 0) {
      return <span className="text-[.82rem] font-semibold text-[var(--n-700)]">{homeLabel}</span>;
    }
    return (
      <div className="text-[.82rem] font-medium text-[var(--n-400)]">
        <span>{homeLabel}</span>
        {segments.map((s, i) => (
          <span key={s.id}>
            <span className="mx-[.35rem] opacity-35">›</span>
            {i === segments.length - 1 ? (
              <b className="font-semibold text-[var(--n-700)]">{s.name}</b>
            ) : (
              <span>{s.name}</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  const routeLabel = getRouteLabel(location.pathname, t);
  if (routeLabel) {
    return (
      <div className="text-[.82rem] font-medium text-[var(--n-400)]">
        <span>{homeLabel}</span>
        <span className="mx-[.35rem] opacity-35">›</span>
        <b className="font-semibold text-[var(--n-700)]">{routeLabel}</b>
      </div>
    );
  }

  return <span className="text-[.82rem] font-semibold text-[var(--n-700)]">{homeLabel}</span>;
}

// Mobile topbar leading slot — burger when contextual nav is available, Sowel logo otherwise.
// Keeps the title at a consistent x position across all pages.
function MobileTopbarBurger() {
  const { t } = useTranslation();
  const location = useLocation();
  const tree = useZones((s) => s.tree);
  const hasProduction = useEnergy((s) => s.hasProduction);
  const openZoneDrawer = useUiState((s) => s.openZoneDrawer);
  const openEnergyNav = useUiState((s) => s.openEnergyNav);
  const openAnalyseNav = useUiState((s) => s.openAnalyseNav);

  const onZonePage = location.pathname === "/home" || location.pathname.startsWith("/home/");
  const onEnergyPage = location.pathname.startsWith("/energy");
  const onAnalysePage = location.pathname.startsWith("/analyse");

  let onClick: (() => void) | null = null;
  let label = "";
  if (onZonePage && tree.length > 0) {
    onClick = openZoneDrawer;
    label = t("zones.openTree", "Open zones");
  } else if (onEnergyPage && hasProduction) {
    onClick = openEnergyNav;
    label = t("nav.energy");
  } else if (onAnalysePage) {
    onClick = openAnalyseNav;
    label = t("analyse.title");
  }

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="sm:hidden w-10 h-10 -ml-2 flex items-center justify-center rounded-[6px] text-text-secondary hover:bg-border-light/60 transition-colors duration-150"
        aria-label={label}
      >
        <Menu size={20} strokeWidth={1.7} />
      </button>
    );
  }

  // No contextual nav → Sowel logo placeholder, taps go to /home for brand-consistent return.
  return (
    <NavLink
      to="/home"
      className="sm:hidden w-10 h-10 -ml-2 flex items-center justify-center rounded-[6px] hover:bg-border-light/60 transition-colors duration-150"
      aria-label="Sowel"
    >
      <SowelLogo size={24} />
    </NavLink>
  );
}

// Mobile topbar title — home name big, current context small.
// Title = home name (e.g. "Grange Neuve"), sub = zone path / mode name / route label (e.g. "RDC · Séjour", "Énergie").
function MobileTopbarTitle({ homeName }: { homeName: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const tree = useZones((s) => s.tree);
  const modes = useModes((s) => s.modes);

  const homeLabel = homeName || t("nav.maison");
  let sub: string | null = null;

  const onHomeRoute = location.pathname === "/home" || location.pathname.startsWith("/home/");
  const zoneMatch = location.pathname.match(/^\/home\/([^/]+)/);
  if (zoneMatch) {
    const path = buildZonePath(zoneMatch[1], tree);
    if (path.length > 0) {
      const segments = path[0].id === ROOT_ZONE_ID ? path.slice(1) : path;
      sub = segments.length > 0 ? segments.map((s) => s.name).join(" · ") : t("nav.maison");
    }
  } else if (onHomeRoute) {
    // /home without a zoneId (transient before redirect, or single-zone setup)
    sub = t("nav.maison");
  } else {
    const modeMatch = location.pathname.match(/^\/modes\/([^/]+)/);
    if (modeMatch) {
      const mode = modes.find((m) => m.id === modeMatch[1]);
      if (mode) sub = `${t("nav.modes")} · ${mode.name}`;
    } else {
      sub = getRouteLabel(location.pathname, t);
    }
  }

  return (
    <div className="min-w-0">
      <div className="text-[16px] font-bold text-text leading-[1.15] tracking-[-0.015em] truncate">
        {homeLabel}
      </div>
      {sub && (
        <div className="text-[11px] text-text-tertiary font-medium leading-[1.3] truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

function buildZonePath(zoneId: string, tree: ZoneWithChildren[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  function walk(zones: ZoneWithChildren[], trail: { id: string; name: string }[]): boolean {
    for (const z of zones) {
      const next = [...trail, { id: z.id, name: z.name }];
      if (z.id === zoneId) {
        out.push(...next);
        return true;
      }
      if (walk(z.children, next)) return true;
    }
    return false;
  }
  walk(tree, []);
  return out;
}

function getRouteLabel(pathname: string, t: (k: string) => string): string | null {
  if (pathname.startsWith("/dashboard")) return t("nav.dashboard");
  if (pathname.startsWith("/energy")) {
    const energy = t("nav.energy");
    if (pathname.startsWith("/energy/live")) return `${energy} · ${t("nav.energy.live")}`;
    if (pathname.startsWith("/energy/consumption"))
      return `${energy} · ${t("nav.energy.consumption")}`;
    if (pathname.startsWith("/energy/production"))
      return `${energy} · ${t("nav.energy.production")}`;
    return energy;
  }
  if (pathname.startsWith("/modes")) return t("nav.modes");
  if (pathname.startsWith("/analyse")) return t("nav.analyse");
  if (pathname.startsWith("/calendar")) return t("nav.calendar");
  if (pathname.startsWith("/integrations")) return t("nav.integrations");
  if (pathname.startsWith("/plugins")) return t("nav.plugins");
  if (pathname.startsWith("/mqtt-publishers")) return t("nav.mqttPublishers");
  if (pathname.startsWith("/notification-publishers")) return t("nav.notificationPublishers");
  if (pathname.startsWith("/logs")) return t("nav.logs");
  if (pathname.startsWith("/backup")) return t("nav.backup");
  if (pathname.startsWith("/settings")) return t("nav.settings");
  if (pathname.startsWith("/devices")) return t("nav.devices");
  if (pathname.startsWith("/equipments")) return t("nav.equipments");
  if (pathname.startsWith("/zones")) return t("nav.zones");
  return null;
}

function MobileNav({
  drawerOpen,
  setDrawerOpen,
}: {
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const energyAvailable = useEnergy((s) => s.available);

  return (
    <>
      <nav className="flex lg:hidden flex-col border-t border-border bg-surface">
        <div className="flex items-center justify-around min-h-[56px] px-2">
          <MobileNavLink
            to="/dashboard"
            label={t("nav.dashboard")}
            icon={<LayoutDashboard size={18} strokeWidth={1.5} />}
          />
          <MobileNavLink
            to="/home"
            label={t("nav.maison")}
            icon={<Home size={18} strokeWidth={1.5} />}
          />
          {energyAvailable && (
            <MobileNavLink
              to="/energy"
              label={t("nav.energy")}
              icon={<Zap size={18} strokeWidth={1.5} />}
            />
          )}
          <MobileNavLink
            to="/modes"
            label={t("nav.modes")}
            icon={<Layers size={18} strokeWidth={1.5} />}
          />
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center justify-center py-1 px-3 rounded-[6px] text-[11px] font-medium text-text-secondary"
          >
            <span className="mb-0.5">
              <Menu size={18} strokeWidth={1.5} />
            </span>
            <span className="text-[11px]">{t("nav.more", "Plus")}</span>
          </button>
        </div>
        {/* Safe area spacer for iOS PWA home indicator */}
        <div
          className="bg-surface flex-shrink-0"
          style={{ height: "env(safe-area-inset-bottom, 0px)" }}
        />
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
          <span className="text-[13px] font-semibold text-text-secondary uppercase tracking-widest">
            {t("nav.more", "Plus")}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] text-text-tertiary hover:bg-border-light"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-3 pb-4 space-y-1">
          {/* Settings */}
          <DrawerLink
            icon={<Settings size={18} strokeWidth={1.5} />}
            label={t("nav.settings")}
            onClick={() => go("/settings")}
          />

          {/* Analyse */}
          <DrawerLink
            icon={<BarChart3 size={18} strokeWidth={1.5} />}
            label={t("nav.analyse")}
            onClick={() => go("/analyse")}
          />

          {/* Admin section */}
          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-2">
                <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">
                  {t("nav.administration")}
                </span>
              </div>
              <DrawerLink
                icon={<Calendar size={18} strokeWidth={1.5} />}
                label={t("nav.calendar")}
                onClick={() => go("/calendar")}
              />
              <DrawerLink
                icon={<Plug size={18} strokeWidth={1.5} />}
                label={t("nav.integrations")}
                onClick={() => go("/integrations")}
              />
              <DrawerLink
                icon={<Send size={18} strokeWidth={1.5} />}
                label={t("nav.mqttPublishers")}
                onClick={() => go("/mqtt-publishers")}
              />
              <DrawerLink
                icon={<Bell size={18} strokeWidth={1.5} />}
                label={t("nav.notificationPublishers")}
                onClick={() => go("/notification-publishers")}
              />
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
                  onClick={() => {
                    logout();
                    onClose();
                  }}
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
        <div
          className="bg-surface flex-shrink-0"
          style={{ height: "env(safe-area-inset-bottom, 0px)" }}
        />
      </div>
    </div>
  );
}

function DrawerLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
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
