import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Package,
  Loader2,
  Download,
  Trash2,
  Cpu,
  ArrowUpCircle,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  UserRound,
  FolderGit2,
  Plus,
  X,
} from "lucide-react";
import { refreshPluginUpdateCount } from "../components/layout/usePluginUpdates";
import * as LucideIcons from "lucide-react";
import {
  getPlugins,
  getPluginStore,
  refreshPluginStore,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  getPluginSources,
  addPluginSource,
  removePluginSource,
  CommunityPluginConfirmationRequiredError,
  PersonalPluginConfirmationRequiredError,
} from "../api";
import type {
  PluginInfo,
  PluginManifest,
  PluginSource,
  IntegrationStatus,
  PackageType,
  PackageTier,
} from "../types";

/** Identity of a personal plugin pending TOFU confirmation (spec 136). */
interface PersonalConfirmInfo {
  repo: string;
  owner: string;
  version: string;
  sha256: string;
}

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
  const [sources, setSources] = useState<PluginSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [category, setCategory] = useState<CategoryFilter>("integration");

  const load = useCallback(async () => {
    try {
      const [installedData, storeData, sourcesData] = await Promise.all([
        getPlugins(),
        getPluginStore(),
        getPluginSources(),
      ]);
      setPlugins(installedData);
      setStore(storeData);
      setSources(sourcesData);
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshPluginStore();
      await load();
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
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
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Package size={22} strokeWidth={1.5} className="text-text-secondary" />
            <h1>
              {t("plugins.title")}
            </h1>
          </div>
          <p className="text-[13px] text-text-secondary mt-1">{t("plugins.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light hover:text-text transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("plugins.refreshRegistryTitle")}
        >
          {refreshing ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.5} />
          ) : (
            <RefreshCw size={14} strokeWidth={1.5} />
          )}
          {t("plugins.refreshRegistry")}
        </button>
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
          <StoreTab
            store={filteredStore}
            installedIds={installedIds}
            sources={sources}
            lang={lang}
            onRefresh={load}
          />
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
  const [confirmPersonalUpdate, setConfirmPersonalUpdate] = useState<PersonalConfirmInfo | null>(
    null,
  );

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[plugin.manifest.icon] ?? Cpu;

  const hasUpdate = !!plugin.latestVersion;
  const isRecipe = getManifestType(plugin.manifest) === "recipe";
  const isPersonal = plugin.source === "personal";

  const doUpdate = async (opts: { confirmed?: boolean; expectedSha256?: string } = {}) => {
    setActionLoading("update");
    try {
      await updatePlugin(plugin.manifest.id, opts);
      setConfirmPersonalUpdate(null);
      // Small delay to let the plugin restart before refreshing
      await new Promise((r) => setTimeout(r, 1500));
      onRefresh();
    } catch (err) {
      // Spec 136: personal package — the server asks for TOFU re-confirmation.
      if (err instanceof PersonalPluginConfirmationRequiredError) {
        setConfirmPersonalUpdate({
          repo: err.repo,
          owner: err.owner,
          version: err.version,
          sha256: err.sha256,
        });
      }
      // other errors are surfaced through default fetch error handling
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdate = (e: React.MouseEvent) => {
    e.stopPropagation();
    void doUpdate();
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
          {isPersonal && <PersonalBadge />}
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

      {/* Personal plugin TOFU re-confirmation modal (spec 136) */}
      {confirmPersonalUpdate && (
        <PersonalConfirmModal
          info={confirmPersonalUpdate}
          mode="update"
          busy={actionLoading === "update"}
          onCancel={() => setConfirmPersonalUpdate(null)}
          onConfirm={() =>
            doUpdate({ confirmed: true, expectedSha256: confirmPersonalUpdate.sha256 })
          }
        />
      )}
    </div>
  );
}

// ── Store Tab ────────────────────────────────────────────────

function StoreTab({
  store,
  installedIds,
  sources,
  lang,
  onRefresh,
}: {
  store: PluginManifest[];
  installedIds: Set<string>;
  sources: PluginSource[];
  lang: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {store.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-[14px]">
          <Package size={40} strokeWidth={1} className="mx-auto mb-3 text-text-tertiary/50" />
          {t("plugins.noPlugins")}
        </div>
      ) : (
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
      )}

      {/* Personal sources management (spec 136) */}
      <PersonalSourcesSection sources={sources} onRefresh={onRefresh} />
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
  manifest: PluginManifest & {
    compatible?: boolean;
    compatReason?: string;
    isOfficial?: boolean;
    tier?: PackageTier;
  };
  installed: boolean;
  lang: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [confirmCommunity, setConfirmCommunity] = useState<{ owner: string } | null>(null);
  const [confirmPersonal, setConfirmPersonal] = useState<PersonalConfirmInfo | null>(null);
  const compatible = manifest.compatible !== false;
  const isOfficial = manifest.isOfficial !== false;
  const tier: PackageTier = manifest.tier ?? (isOfficial ? "official" : "community");

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[manifest.icon] ?? Cpu;

  const doInstall = async (confirmed: boolean, expectedSha256?: string) => {
    setInstalling(true);
    try {
      await installPlugin(manifest.repo ?? manifest.id, confirmed, expectedSha256);
      setConfirmCommunity(null);
      setConfirmPersonal(null);
      onRefresh();
    } catch (err) {
      if (err instanceof CommunityPluginConfirmationRequiredError) {
        setConfirmCommunity({ owner: err.owner });
      } else if (err instanceof PersonalPluginConfirmationRequiredError) {
        // Spec 136: the server computed the tarball identity — show it.
        setConfirmPersonal({
          repo: err.repo,
          owner: err.owner,
          version: err.version,
          sha256: err.sha256,
        });
      }
      // other errors are surfaced through default fetch error handling
    } finally {
      setInstalling(false);
    }
  };

  const handleInstall = () => doInstall(false);

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
          {/* Community badge — owner is not in OFFICIAL_OWNERS (spec 089 C1) */}
          {tier === "community" && (
            <span
              className="text-[10px] px-1.5 py-0.5 bg-warning/10 text-warning rounded-[4px] font-medium shrink-0 inline-flex items-center gap-1"
              title={t("plugins.community.badge.tooltip")}
            >
              <AlertTriangle size={10} strokeWidth={2} />
              {t("plugins.community.badge")}
            </span>
          )}
          {/* Personal badge — user-added source (spec 136) */}
          {tier === "personal" && <PersonalBadge />}
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

      {/* Personal plugin TOFU confirm modal (spec 136) */}
      {confirmPersonal && (
        <PersonalConfirmModal
          info={confirmPersonal}
          mode="install"
          busy={installing}
          onCancel={() => setConfirmPersonal(null)}
          onConfirm={() => doInstall(true, confirmPersonal.sha256)}
        />
      )}

      {/* Community plugin confirm modal (spec 089 C1) */}
      {confirmCommunity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-[14px] max-w-md w-full p-6 space-y-4 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-warning" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-text">
                  {t("plugins.community.modal.title")}
                </h3>
                <p className="text-[13px] text-text-secondary mt-1">
                  {t("plugins.community.modal.body", { owner: confirmCommunity.owner })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmCommunity(null)}
                disabled={installing}
                className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:bg-border-light rounded-[6px] transition-colors disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => doInstall(true)}
                disabled={installing}
                className="px-4 py-2 text-[13px] font-medium text-white bg-warning hover:opacity-90 rounded-[6px] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {installing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {t("plugins.community.modal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Personal Badge (spec 136) ────────────────────────────────

function PersonalBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-[4px] font-medium shrink-0 inline-flex items-center gap-1"
      title={t("plugins.personal.badge.tooltip")}
    >
      <UserRound size={10} strokeWidth={2} />
      {t("plugins.personal.badge")}
    </span>
  );
}

// ── Personal TOFU Confirm Modal (spec 136) ───────────────────

function IdentityRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] text-text-tertiary shrink-0">{label}</span>
      <span className="text-[12px] font-mono text-text truncate" title={title ?? value}>
        {value}
      </span>
    </div>
  );
}

function PersonalConfirmModal({
  info,
  mode,
  busy,
  onCancel,
  onConfirm,
}: {
  info: PersonalConfirmInfo;
  mode: "install" | "update";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const isInstall = mode === "install";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface rounded-[14px] max-w-md w-full p-6 space-y-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldAlert size={20} className="text-primary" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-text">
              {t("plugins.personal.modal.title")}
            </h3>
            <p className="text-[13px] text-text-secondary mt-1">
              {t(
                isInstall ? "plugins.personal.modal.body" : "plugins.personal.modal.updateBody",
                { repo: info.repo },
              )}
            </p>
          </div>
        </div>

        {/* Identity of what will be installed — version + pinned fingerprint */}
        <div className="bg-background border border-border rounded-[10px] px-4 py-3 space-y-2">
          <IdentityRow label={t("plugins.personal.modal.repository")} value={info.repo} />
          <IdentityRow label={t("plugins.personal.modal.version")} value={info.version} />
          <IdentityRow
            label={t("plugins.personal.modal.fingerprint")}
            value={`${info.sha256.slice(0, 12)}…`}
            title={info.sha256}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:bg-border-light rounded-[6px] transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isInstall ? (
              <Download size={14} />
            ) : (
              <ArrowUpCircle size={14} />
            )}
            {t(isInstall ? "plugins.personal.modal.confirm" : "plugins.personal.modal.confirmUpdate")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Personal Sources Section (spec 136) ──────────────────────

function PersonalSourcesSection({
  sources,
  onRefresh,
}: {
  sources: PluginSource[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [repoInput, setRepoInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = repoInput.trim();
    if (!repo || adding) return;
    setAdding(true);
    setError(null);
    try {
      await addPluginSource(repo);
      setRepoInput("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="bg-surface border border-border rounded-[10px]">
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 py-3">
        <FolderGit2 size={16} strokeWidth={1.5} className="text-text-secondary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-text">{t("plugins.sources.title")}</h2>
          <p className="text-[12px] text-text-secondary mt-0.5">{t("plugins.sources.subtitle")}</p>
        </div>
      </div>

      {/* Source list */}
      {sources.length > 0 && (
        <ul className="border-t border-border-light divide-y divide-border-light">
          {sources.map((source) => (
            <SourceRow key={source.repo} source={source} onRefresh={onRefresh} />
          ))}
        </ul>
      )}

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="flex items-center gap-2 px-4 py-3 border-t border-border-light"
      >
        <input
          value={repoInput}
          onChange={(e) => {
            setRepoInput(e.target.value);
            setError(null);
          }}
          placeholder={t("plugins.sources.placeholder")}
          spellCheck={false}
          autoCapitalize="none"
          className="flex-1 min-w-0 px-3 py-1.5 text-[13px] font-mono text-text bg-background border border-border rounded-[6px] placeholder:text-text-tertiary placeholder:font-mono focus:outline-none focus:border-primary transition-colors"
        />
        <button
          type="submit"
          disabled={adding || !repoInput.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {adding ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} strokeWidth={2} />
          )}
          {t("plugins.sources.add")}
        </button>
      </form>
      {error && <p className="px-4 pb-3 -mt-1 text-[12px] text-error">{error}</p>}
    </section>
  );
}

function SourceRow({ source, onRefresh }: { source: PluginSource; onRefresh: () => void }) {
  const { t } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setRemoving(true);
    try {
      await removePluginSource(source.repo);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex-1 min-w-0 text-[13px] font-mono text-text truncate">{source.repo}</span>
      {source.latestVersion ? (
        <span className="text-[10px] px-1.5 py-0.5 bg-border-light rounded-[4px] text-text-tertiary font-mono shrink-0">
          {source.latestVersion}
        </span>
      ) : (
        <span className="text-[11px] text-text-tertiary shrink-0">
          {t("plugins.sources.noRelease")}
        </span>
      )}
      <button
        onClick={handleRemove}
        onBlur={() => setConfirmRemove(false)}
        disabled={removing}
        title={t("plugins.sources.removeHint")}
        className={`
          flex items-center gap-1 rounded-[5px] transition-colors cursor-pointer disabled:opacity-50 shrink-0
          ${confirmRemove
            ? "text-error bg-error/10 px-2 py-1 text-xs font-medium"
            : "p-1.5 text-text-tertiary hover:bg-border-light hover:text-error"
          }
        `}
      >
        {removing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : confirmRemove ? (
          t("plugins.sources.removeConfirm")
        ) : (
          <X size={14} />
        )}
      </button>
    </li>
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
