import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ArrowUpCircle, Power, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../dashboard/BottomSheet";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { IntegrationStatus, PackageSource, PackageType } from "../../types";

/**
 * Detail surface for one installed plugin (issue #749).
 *
 * The list row was carrying six controls in a single flex line, which collapsed
 * the plugin name to zero width below ~500px. The row now carries identity only
 * and everything else lives here: full description, versions, provenance, and
 * the actions as full-width targets with uninstall isolated at the bottom.
 *
 * Bottom sheet under 640px (the shared BottomSheet, as the recipe log panel
 * uses at #615), right-hand drawer above.
 */

export interface PluginDetailSheetProps {
  open: boolean;
  onClose: () => void;
  name: string;
  description: string;
  icon: ReactNode;
  type: PackageType;
  installedVersion: string;
  latestVersion?: string;
  author?: string;
  source: PackageSource;
  enabled: boolean;
  /** Integration-only runtime facts; omitted for recipes. */
  status?: IntegrationStatus;
  deviceCount?: number;
  offlineDeviceCount?: number;
  /** "update" | "enable" | "disable" | "uninstall" while an action is in flight. */
  actionLoading: string | null;
  confirmUninstall: boolean;
  onUpdate: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}

export function PluginDetailSheet(props: PluginDetailSheetProps) {
  const { open, onClose, name, icon } = props;
  const isMobile = useIsMobile();

  return (
    <>
      <BottomSheet open={open && isMobile} onClose={onClose} title={name} icon={icon}>
        <DetailBody {...props} />
      </BottomSheet>
      {open && !isMobile && (
        <SidePanel onClose={onClose} title={name} subtitle={<Subtitle {...props} />} icon={icon}>
          <DetailBody {...props} />
        </SidePanel>
      )}
    </>
  );
}

// ── Desktop drawer ───────────────────────────────────────────

function SidePanel({
  onClose,
  title,
  subtitle,
  icon,
  children,
}: {
  onClose: () => void;
  title: string;
  subtitle: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);

  // BottomSheet already does this for the mobile branch; the drawer needs the
  // same treatment or the page keeps scrolling and tabbing behind the backdrop.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute right-0 top-0 bottom-0 w-full max-w-[380px] bg-surface border-l border-border shadow-xl flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-text truncate">{title}</h2>
            {subtitle}
          </div>
          <button
            onClick={onClose}
            title={t("common.close")}
            className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors cursor-pointer shrink-0"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

// ── Shared body ──────────────────────────────────────────────

function Subtitle({ type }: { type: PackageType }) {
  const { t } = useTranslation();
  return (
    <p className="text-[12px] text-text-tertiary mt-0.5">
      {t(type === "recipe" ? "plugins.recipe_badge" : "plugins.integration_badge")}
    </p>
  );
}

function DetailBody({
  description,
  type,
  installedVersion,
  latestVersion,
  author,
  source,
  enabled,
  status,
  deviceCount,
  offlineDeviceCount,
  actionLoading,
  confirmUninstall,
  onUpdate,
  onToggle,
  onUninstall,
}: PluginDetailSheetProps) {
  const { t } = useTranslation();
  const busy = actionLoading !== null;

  return (
    <div className="space-y-4">
      {description && <p className="text-[13px] text-text-secondary">{description}</p>}

      <dl className="border-y border-border-light divide-y divide-border-light">
        <IdentityRow label={t("plugins.detail.installedVersion")} value={installedVersion} mono />
        {latestVersion && (
          <IdentityRow label={t("plugins.detail.available")} value={latestVersion} mono accent />
        )}
        {author && <IdentityRow label={t("plugins.author")} value={author} />}
        <IdentityRow
          label={t("plugins.detail.provenance")}
          value={t(
            source === "personal"
              ? "plugins.detail.sourcePersonal"
              : "plugins.detail.sourceRegistry",
          )}
        />
        {type === "integration" && status && (
          <IdentityRow
            label={t("plugins.detail.state")}
            // Same folding as the row's StatusBadge: an unconfigured plugin
            // reads as disconnected, not as its own third state.
            value={t(`status.${status === "not_configured" ? "disconnected" : status}`)}
          />
        )}
        {type === "integration" && deviceCount !== undefined && (
          <IdentityRow
            label={t("plugins.devices")}
            value={
              offlineDeviceCount
                ? t("plugins.detail.devicesWithOffline", {
                    devices: deviceCount,
                    offline: offlineDeviceCount,
                  })
                : String(deviceCount)
            }
          />
        )}
      </dl>

      <div className="flex flex-col gap-2">
        {latestVersion && (
          <button
            onClick={onUpdate}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 w-full min-h-[44px] px-4 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors cursor-pointer disabled:opacity-50"
          >
            {actionLoading === "update" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowUpCircle size={15} strokeWidth={1.5} />
            )}
            {t("plugins.updateTo", { version: latestVersion })}
          </button>
        )}

        <button
          onClick={onToggle}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 w-full min-h-[44px] px-4 text-[13px] font-medium text-text-secondary border border-border rounded-[8px] hover:bg-border-light hover:text-text transition-colors cursor-pointer disabled:opacity-50"
        >
          {actionLoading === "enable" || actionLoading === "disable" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Power size={15} strokeWidth={1.5} />
          )}
          {enabled ? t("plugins.disable") : t("plugins.enable")}
        </button>

        {/* Destructive action, deliberately detached from the toggle above. */}
        <button
          onClick={onUninstall}
          disabled={busy}
          className={`
            inline-flex items-center justify-center gap-2 w-full min-h-[44px] px-4 mt-2
            text-[13px] font-medium rounded-[8px] transition-colors cursor-pointer disabled:opacity-50
            ${confirmUninstall ? "text-white bg-error" : "text-error hover:bg-error/10"}
          `}
        >
          {actionLoading === "uninstall" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Trash2 size={15} strokeWidth={1.5} />
          )}
          {confirmUninstall
            ? enabled
              ? t("plugins.uninstallConfirmActive")
              : t("plugins.uninstallConfirm")
            : t("plugins.uninstall")}
        </button>
      </div>
    </div>
  );
}

function IdentityRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-[12px] text-text-tertiary shrink-0">{label}</dt>
      <dd
        className={`text-[12px] text-right min-w-0 truncate ${mono ? "font-mono" : ""} ${
          accent ? "text-error" : "text-text"
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
