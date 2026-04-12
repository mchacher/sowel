import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Package, Loader2, Download, Trash2, Cpu, ArrowUpCircle } from "lucide-react";
import { refreshPluginUpdateCount } from "../components/layout/usePluginUpdates";
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
import type { PluginInfo, PluginManifest, IntegrationStatus, PackageType } from "../types";

type Tab = "installed" | "store";
type CategoryFilter = "integration" | "recipe";

function getManifestType(manifest: PluginManifest): PackageType {
  return manifest.type ?? "integration";
}

/** Get localized name from manifest i18n if available */
function getLocalizedName(manifest: PluginManifest, lang: string): string {
  return manifest.i18n?.[lang]?.name ?? manifest.name;
}

/** Get localized description from manifest i18n if available */
function getLocalizedDescription(manifest: PluginManifest, lang: string): string {
  return manifest.i18n?.[lang]?.description ?? manifest.description;
}

export function PluginsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.split("-")[0] ?? "en";
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [store, setStore] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [category, setCategory] = useState<CategoryFilter>("integration");

  const load = useCallback(async () => {
    try {
      const [installedData, storeData] = await Promise.all([
        getPlugins(),
        getPluginStore(),
      ]);
      setPlugins(installedData);
      setStore(storeData);
      refreshPluginUpdateCount();
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

  // Check if there are any recipes (to show/hide category filter)
  const hasRecipes =
    plugins.some((p) => getManifestType(p.manifest) === "recipe") ||
    store.some((m) => getManifestType(m) === "recipe");

  // Filter by category
  const filteredPlugins = plugins.filter((p) => getManifestType(p.manifest) === category);
  const filteredStore = store.filter((m) => getManifestType(m) === category);

  // Counts per category
  const integrationCount =
    activeTab === "installed"
      ? plugins.filter((p) => getManifestType(p.manifest) === "integration").length
      : store.filter((m) => getManifestType(m) === "integration").length;
  const recipeCount =
    activeTab === "installed"
      ? plugins.filter((p) => getManifestType(p.manifest) === "recipe").length
      : store.filter((m) => getManifestType(m) === "recipe").length;

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

      {/* Tabs: Installed / Store */}
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

      {/* Category filter: Integrations / Recipes */}
      {hasRecipes && (
        <div className="flex items-center gap-1 mb-4 border-b border-border max-w-[720px]">
          <CategoryTab
            label={t("plugins.integrations")}
            count={integrationCount}
            active={category === "integration"}
            onClick={() => setCategory("integration")}
          />
          <CategoryTab
            label={t("plugins.recipes")}
            count={recipeCount}
            active={category === "recipe"}
            onClick={() => setCategory("recipe")}
          />
        </div>
      )}

      {/* Content */}
      <div className="max-w-[720px]">
        {activeTab === "installed" ? (
          <InstalledTab plugins={filteredPlugins} lang={lang} onRefresh={load} />
        ) : (
          <StoreTab store={filteredStore} installedIds={installedIds} lang={lang} onRefresh={load} />
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

// ── Category Tab ─────────────────────────────────────────────

function CategoryTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 text-[13px] font-medium transition-colors duration-150
        border-b-2 -mb-px cursor-pointer
        ${
          active
            ? "border-primary text-primary"
            : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border"
        }
      `}
    >
      {label}
      <span
        className={`ml-1.5 text-[11px] tabular-nums ${active ? "text-primary/70" : "text-text-tertiary"}`}
      >
        {count}
      </span>
    </button>
  );
}

// ── Installed Tab ────────────────────────────────────────────

function InstalledTab({
  plugins,
  lang,
  onRefresh,
}: {
  plugins: PluginInfo[];
  lang: string;
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
        <PluginRow key={plugin.manifest.id} plugin={plugin} lang={lang} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

// ── Plugin Row (installed) ───────────────────────────────────

function PluginRow({
  plugin,
  lang,
  onRefresh,
}: {
  plugin: PluginInfo;
  lang: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[plugin.manifest.icon] ?? Cpu;

  const hasUpdate = !!plugin.latestVersion;
  const isRecipe = getManifestType(plugin.manifest) === "recipe";

  const handleUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading("update");
    try {
      await updatePlugin(plugin.manifest.id);
      // Small delay to let the plugin restart before refreshing
      await new Promise((r) => setTimeout(r, 1500));
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

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text truncate">
            {getLocalizedName(plugin.manifest, lang)}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-border-light rounded-[4px] text-text-tertiary font-mono shrink-0">
            {plugin.manifest.version}
          </span>
          {hasUpdate && (
            <span className="text-[10px] px-1.5 py-0.5 bg-error/10 rounded-[4px] text-error font-mono shrink-0 flex items-center gap-0.5">
              <ArrowUpCircle size={10} />
              {plugin.latestVersion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {!isRecipe ? (
            <>
              <StatusBadge status={plugin.status} />
              <span className="text-[11px] text-text-tertiary">
                {plugin.deviceCount} {t("plugins.devices")}
                {plugin.offlineDeviceCount > 0 && (
                  <span className="text-warning ml-1">({plugin.offlineDeviceCount} off)</span>
                )}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-text-tertiary">
              {getLocalizedDescription(plugin.manifest, lang)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Update */}
        {hasUpdate && (
          <button
            onClick={handleUpdate}
            disabled={actionLoading !== null}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors cursor-pointer disabled:opacity-50 text-error hover:bg-error/10"
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
  lang,
  onRefresh,
}: {
  store: PluginManifest[];
  installedIds: Set<string>;
  lang: string;
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
          lang={lang}
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
  lang,
  onRefresh,
}: {
  manifest: PluginManifest & { compatible?: boolean; compatReason?: string };
  installed: boolean;
  lang: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const compatible = manifest.compatible !== false;

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
            {getLocalizedName(manifest, lang)}
          </span>
          {manifest.version && (
            <span className="text-[10px] px-1.5 py-0.5 bg-border-light rounded-[4px] text-text-tertiary font-mono shrink-0">
              {manifest.version}
            </span>
          )}
        </div>
        <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-1">
          {getLocalizedDescription(manifest, lang)}
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
        ) : compatible ? (
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
        ) : (
          <span className="px-3 py-1.5 text-[11px] font-medium text-text-tertiary bg-border-light rounded-[6px]" title={manifest.compatReason}>
            {manifest.compatReason ?? t("plugins.incompatible")}
          </span>
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
