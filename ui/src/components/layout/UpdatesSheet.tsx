import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { BottomSheet } from "../dashboard/BottomSheet";
import {
  getPlugins,
  triggerSystemUpdate,
  updatePlugin,
  PersonalPluginConfirmationRequiredError,
} from "../../api";
import {
  PersonalBadge,
  PersonalConfirmModal,
  type PersonalConfirmInfo,
} from "../plugins/PersonalConfirm";
import { useWebSocket } from "../../store/useWebSocket";
import { refreshPluginUpdateCount } from "./usePluginUpdates";
import type { PluginInfo, PluginManifest, PackageType } from "../../types";

interface UpdatesSheetProps {
  open: boolean;
  onClose: () => void;
}

const CORE_ROW_ID = "__core__";

function getManifestType(manifest: PluginManifest): PackageType {
  return manifest.type ?? "integration";
}

function getLocalizedName(manifest: PluginManifest, lang: string): string {
  return manifest.i18n?.[lang]?.name ?? manifest.name;
}

function changelogUrl(
  kind: "core" | PackageType,
  repo: string | undefined,
  to: string,
): string | null {
  if (kind === "core") {
    return `https://docs.sowel.org/release-notes/#v${to.replaceAll(".", "-")}`;
  }
  if (!repo) return null;
  return `https://github.com/${repo}/releases/tag/v${to}`;
}

export function UpdatesSheet({ open, onClose }: UpdatesSheetProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.split("-")[0] ?? "en";
  const coreUpdate = useWebSocket((s) => s.updateAvailable);
  const setUpdateInProgress = useWebSocket((s) => s.setUpdateInProgress);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Spec 172 — a personal-source package answers the update with a 409 asking
  // the user to re-pin its fingerprint. The id travels with the identity: the
  // retry targets a package id, the dialog shows a repository.
  const [pending, setPending] = useState<{ id: string; info: PersonalConfirmInfo } | null>(null);
  // Tracks whether the sheet is currently open, so async handlers (whose
  // 1.5 s wait can outlive the close) can bail out before applying stale
  // state writes. Synced from `open` via the effect below.
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    if (!open) return;
    let cancelled = false;
    setError(null);
    setUpdatingId(null);
    setPending(null);
    setPlugins(null);
    getPlugins()
      .then((all) => {
        if (cancelled) return;
        setPlugins(all.filter((p) => p.latestVersion));
      })
      .catch(() => {
        if (cancelled) return;
        setPlugins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const outdated = plugins ?? [];
  // A row awaiting its fingerprint confirmation holds the panel too: nothing is
  // in flight, but one dialog at a time is the whole point of it.
  const busyId = updatingId ?? pending?.id ?? null;
  const showCore = !!coreUpdate;
  const totalCount = outdated.length + (showCore ? 1 : 0);

  async function handleCoreUpdate() {
    if (!coreUpdate) return;
    setError(null);
    setUpdatingId(CORE_ROW_ID);
    try {
      await triggerSystemUpdate();
      // UpdateOverlay takes over from here.
      setUpdateInProgress(true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("updates.error.generic"));
      setUpdatingId(null);
    }
  }

  async function handlePluginUpdate(
    id: string,
    opts: { confirmed?: boolean; expectedSha256?: string } = {},
  ) {
    setError(null);
    setUpdatingId(id);
    try {
      await updatePlugin(id, opts);
      setPending(null);
      // Plugin restart takes a moment — let the backend settle before refreshing the badge.
      await new Promise((r) => setTimeout(r, 1500));
      // Refresh the pill counter regardless of whether the sheet is still open —
      // the user closed the sheet but the update still happened.
      refreshPluginUpdateCount();
      if (!openRef.current) return;
      setPlugins((prev) => (prev ?? []).filter((p) => p.manifest.id !== id));
    } catch (err) {
      if (!openRef.current) return;
      // Spec 172 — not a failure: the server is asking the user to re-pin the
      // fingerprint of a personal package (spec 136). Ask, then retry.
      if (err instanceof PersonalPluginConfirmationRequiredError) {
        setPending({
          id,
          info: { repo: err.repo, owner: err.owner, version: err.version, sha256: err.sha256 },
        });
        return;
      }
      setError(err instanceof Error ? err.message : t("updates.error.generic"));
    } finally {
      if (openRef.current) setUpdatingId(null);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("updates.sheet.title")}
      icon={<RefreshCw size={18} strokeWidth={1.5} className="text-error" />}
    >
      {plugins === null ? (
        <div className="text-center text-text-tertiary text-[13px] py-6">
          {t("common.loading")}
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center text-text-tertiary text-[13px] py-6">
          {t("updates.sheet.empty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-busy={busyId !== null}>
          {showCore && coreUpdate && (
            <UpdateRow
              title="Sowel"
              kind="core"
              from={coreUpdate.current}
              to={coreUpdate.latest}
              changelogHref={changelogUrl("core", undefined, coreUpdate.latest)}
              loading={updatingId === CORE_ROW_ID}
              disabled={busyId !== null && busyId !== CORE_ROW_ID}
              onUpdate={handleCoreUpdate}
            />
          )}
          {outdated.map((p) => {
            const to = p.latestVersion ?? "";
            return (
              <UpdateRow
                key={p.manifest.id}
                title={getLocalizedName(p.manifest, lang)}
                kind={getManifestType(p.manifest)}
                from={p.manifest.version}
                to={to}
                changelogHref={changelogUrl(getManifestType(p.manifest), p.manifest.repo, to)}
                personal={p.source === "personal"}
                loading={updatingId === p.manifest.id}
                disabled={busyId !== null && busyId !== p.manifest.id}
                onUpdate={() => handlePluginUpdate(p.manifest.id)}
              />
            );
          })}
        </ul>
      )}
      {error && (
        <div role="alert" className="mt-3 text-[12px] text-error text-center">
          {error}
        </div>
      )}
      {pending && (
        <PersonalConfirmModal
          info={pending.info}
          mode="update"
          busy={updatingId === pending.id}
          onCancel={() => {
            setPending(null);
            setUpdatingId(null);
          }}
          onConfirm={() =>
            void handlePluginUpdate(pending.id, {
              confirmed: true,
              expectedSha256: pending.info.sha256,
            })
          }
        />
      )}
    </BottomSheet>
  );
}

interface UpdateRowProps {
  title: string;
  kind: "core" | PackageType;
  from: string;
  to: string;
  changelogHref: string | null;
  /** From a personal source (spec 136): the update will ask for a fingerprint. */
  personal?: boolean;
  loading: boolean;
  disabled: boolean;
  onUpdate: () => void;
}

function UpdateRow({
  title,
  kind,
  from,
  to,
  changelogHref,
  personal,
  loading,
  disabled,
  onUpdate,
}: UpdateRowProps) {
  const { t } = useTranslation();
  const badge =
    kind === "core"
      ? null
      : kind === "recipe"
        ? t("updates.badge.recipe")
        : t("updates.badge.integration");
  const changelogTitle = t("updates.action.viewChangelog", { from, to });

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] bg-border-light/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <span className="truncate">{title}</span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded uppercase bg-primary/10 text-primary">
              {badge}
            </span>
          )}
          {/* Spec 172 — the confirmation this row is about to ask for is not a
              surprise if the row says where the package comes from. */}
          {personal && <PersonalBadge />}
        </div>
        <div className="text-[11px] text-text-secondary font-mono mt-0.5">
          {t("updates.sheet.versions", { from, to })}
        </div>
      </div>
      {changelogHref &&
        (loading ? (
          <button
            type="button"
            disabled
            aria-label={changelogTitle}
            title={changelogTitle}
            className="p-1.5 rounded-[6px] text-text-tertiary opacity-50 cursor-not-allowed flex-shrink-0"
          >
            <FileText size={14} strokeWidth={1.5} />
          </button>
        ) : (
          <a
            href={changelogHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={changelogTitle}
            title={changelogTitle}
            className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors cursor-pointer flex-shrink-0"
          >
            <FileText size={14} strokeWidth={1.5} />
          </a>
        ))}
      <button
        type="button"
        onClick={onUpdate}
        disabled={loading || disabled}
        className="px-3 py-1.5 rounded-[6px] bg-primary text-white text-[12px] font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer flex-shrink-0"
      >
        {loading && <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />}
        {t("updates.action.update")}
      </button>
    </li>
  );
}
