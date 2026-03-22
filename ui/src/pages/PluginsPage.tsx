import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Package, Loader2, Download, Trash2, Cpu, ArrowUpCircle } from "lucide-react";
import * as LucideIcons from "lucide-react";
import {
  getPlugins,
  getPluginStore,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
} from "../api";
import type { PluginInfo, PluginManifest, IntegrationStatus } from "../types";

type Tab = "installed" | "store";

export function PluginsPage() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [store, setStore] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("installed");

  const load = useCallback(async () => {
    try {
      const [installedData, storeData] = await Promise.all([
        getPlugins(),
        getPluginStore(),
      ]);
      setPlugins(installedData);
      setStore(storeData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const installedIds = new Set(plugins.map((p) => p.manifest.id));

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <Package size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[20px] sm:text-[24px] font-semibold text-text leading-[32px]">
            {t("plugins.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">{t("plugins.subtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 max-w-[720px]">
        <TabButton
          active={activeTab === "installed"}
          onClick={() => setActiveTab("installed")}
          label={t("plugins.installed")}
          count={plugins.length}
        />
        <TabButton
          active={activeTab === "store"}
          onClick={() => setActiveTab("store")}
          label={t("plugins.store")}
          count={store.length}
        />
      </div>

      {/* Content */}
      <div className="max-w-[720px]">
        {activeTab === "installed" ? (
          <InstalledTab plugins={plugins} onRefresh={load} />
        ) : (
          <StoreTab store={store} installedIds={installedIds} onRefresh={load} />
        )}
      </div>
    </div>
  );
}

// ── Tab Button ───────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 text-[13px] font-medium rounded-[6px] transition-colors cursor-pointer
        ${active
          ? "bg-primary text-white"
          : "bg-surface border border-border text-text-secondary hover:bg-border-light hover:text-text"
        }
      `}
    >
      {label}
      <span
        className={`ml-1.5 text-[11px] ${active ? "text-white/70" : "text-text-tertiary"}`}
      >
        {count}
      </span>
    </button>
  );
}

// ── Installed Tab ────────────────────────────────────────────

function InstalledTab({
  plugins,
  onRefresh,
}: {
  plugins: PluginInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  if (plugins.length === 0) {
    return (
      <div className="text-center py-16 text-text-tertiary text-[14px]">
        <Package size={40} strokeWidth={1} className="mx-auto mb-3 text-text-tertiary/50" />
        {t("plugins.noPlugins")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {plugins.map((plugin) => (
        <PluginRow key={plugin.manifest.id} plugin={plugin} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

// ── Plugin Row (installed) ───────────────────────────────────

function PluginRow({
  plugin,
  onRefresh,
}: {
  plugin: PluginInfo;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[plugin.manifest.icon] ?? Cpu;

  const hasUpdate = !!plugin.latestVersion;

  const handleUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading("update");
    try {
      await updatePlugin(plugin.manifest.id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const action = plugin.enabled ? "disable" : "enable";
    setActionLoading(action);
    try {
      if (plugin.enabled) {
        await disablePlugin(plugin.manifest.id);
      } else {
        await enablePlugin(plugin.manifest.id);
      }
      onRefresh();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleUninstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmUninstall) {
      setConfirmUninstall(true);
      return;
    }
    setActionLoading("uninstall");
    try {
      await uninstallPlugin(plugin.manifest.id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
      setConfirmUninstall(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-[10px]">
      {/* Icon */}
      <div className="w-9 h-9 bg-accent/10 rounded-[8px] flex items-center justify-center shrink-0">
        <IconComponent size={18} className="text-accent" />
      </div>

      {/* Name + status */}
      <div className="min-w-0 w-[180px] sm:w-[220px] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text truncate block">
            {plugin.manifest.name}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-border-light rounded-[4px] text-text-tertiary font-mono shrink-0">
            {plugin.manifest.version}
          </span>
          {hasUpdate && (
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 rounded-[4px] text-accent font-mono shrink-0 flex items-center gap-0.5">
              <ArrowUpCircle size={10} />
              {plugin.latestVersion}
            </span>
          )}
        </div>
        <StatusBadge status={plugin.status} />
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-4 text-[12px] text-text-tertiary flex-1">
        <span>
          {plugin.deviceCount} {t("plugins.devices")}
          {plugin.offlineDeviceCount > 0 && (
            <span className="text-warning ml-1">({plugin.offlineDeviceCount} off)</span>
          )}
        </span>
      </div>

      {/* Mobile stats */}
      <div className="flex sm:hidden items-center gap-2 text-[11px] text-text-tertiary flex-1">
        <span>{plugin.deviceCount} dev</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Update */}
        {hasUpdate && (
          <button
            onClick={handleUpdate}
            disabled={actionLoading !== null}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors cursor-pointer disabled:opacity-50 text-accent hover:bg-accent/10"
          >
            {actionLoading === "update" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <>
                <ArrowUpCircle size={12} />
                {t("plugins.update")}
              </>
            )}
          </button>
        )}

        {/* Toggle enable/disable */}
        <button
          onClick={handleToggle}
          disabled={actionLoading !== null}
          className={`
            px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors cursor-pointer disabled:opacity-50
            ${plugin.enabled
              ? "text-text-tertiary hover:bg-border-light hover:text-text-secondary"
              : "text-success/70 hover:bg-success/10 hover:text-success"
            }
          `}
        >
          {actionLoading === "enable" || actionLoading === "disable" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : plugin.enabled ? (
            t("plugins.disable")
          ) : (
            t("plugins.enable")
          )}
        </button>

        {/* Uninstall */}
        <button
          onClick={handleUninstall}
          onBlur={() => setConfirmUninstall(false)}
          disabled={actionLoading === "uninstall"}
          title={t("plugins.uninstall")}
          className={`
            flex items-center gap-1 rounded-[5px] transition-colors cursor-pointer disabled:opacity-50
            ${confirmUninstall
              ? "text-error bg-error/10 px-2 py-1 text-xs font-medium"
              : "p-1.5 text-text-tertiary hover:bg-border-light hover:text-error"
            }
          `}
        >
          {actionLoading === "uninstall" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : confirmUninstall ? (
            <>{plugin.enabled ? t("plugins.uninstallConfirmActive") : t("plugins.uninstallConfirm")}</>
          ) : (
            <Trash2 size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Store Tab ────────────────────────────────────────────────

function StoreTab({
  store,
  installedIds,
  onRefresh,
}: {
  store: PluginManifest[];
  installedIds: Set<string>;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  if (store.length === 0) {
    return (
      <div className="text-center py-16 text-text-tertiary text-[14px]">
        <Package size={40} strokeWidth={1} className="mx-auto mb-3 text-text-tertiary/50" />
        {t("plugins.noPlugins")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {store.map((manifest) => (
        <StoreRow
          key={manifest.id}
          manifest={manifest}
          installed={installedIds.has(manifest.id)}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

// ── Store Row ────────────────────────────────────────────────

function StoreRow({
  manifest,
  installed,
  onRefresh,
}: {
  manifest: PluginManifest;
  installed: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[manifest.icon] ?? Cpu;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installPlugin(manifest.repo ?? manifest.id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-[10px]">
      {/* Icon */}
      <div className="w-9 h-9 bg-accent/10 rounded-[8px] flex items-center justify-center shrink-0">
        <IconComponent size={18} className="text-accent" />
      </div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text truncate">
            {manifest.name}
          </span>
          {manifest.version && (
            <span className="text-[10px] px-1.5 py-0.5 bg-border-light rounded-[4px] text-text-tertiary font-mono shrink-0">
              {manifest.version}
            </span>
          )}
        </div>
        <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-1">
          {manifest.description}
        </p>
        {manifest.author && (
          <span className="text-[11px] text-text-tertiary">
            {t("plugins.author")}: {manifest.author}
          </span>
        )}
      </div>

      {/* Install button or installed badge */}
      <div className="shrink-0">
        {installed ? (
          <span className="px-3 py-1.5 text-[12px] font-medium text-success bg-success/10 rounded-[6px]">
            {t("plugins.installed_badge")}
          </span>
        ) : (
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors cursor-pointer disabled:opacity-50"
          >
            {installing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("plugins.installing")}
              </>
            ) : (
              <>
                <Download size={14} />
                {t("plugins.install")}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const { t } = useTranslation();

  const config = {
    connected: { dot: "bg-success", text: "text-success" },
    disconnected: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
    error: { dot: "bg-error", text: "text-error" },
    not_configured: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
  };

  const { dot, text } = config[status];
  const label = status === "not_configured" ? "disconnected" : status;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${text} mt-0.5`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {t(`status.${label}`)}
    </span>
  );
}
