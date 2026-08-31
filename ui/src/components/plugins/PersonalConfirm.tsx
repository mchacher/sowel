import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle, Download, Loader2, ShieldAlert, UserRound } from "lucide-react";

/**
 * Spec 136 — the trust surface of a personal-source package: the fingerprint
 * dialog and the badge that says where the package comes from.
 *
 * Shared rather than private to the Plugins page since spec 172: the top-bar
 * updates panel starts the same update and hits the same 409, so it must be
 * able to answer it with the same dialog. Two copies of a security prompt is
 * how two prompts end up saying different things.
 */

/** Identity of a personal plugin pending TOFU confirmation (spec 136). */
export interface PersonalConfirmInfo {
  repo: string;
  owner: string;
  version: string;
  sha256: string;
}

export function PersonalBadge() {
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

export function PersonalConfirmModal({
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

  // Portaled above the detail sheet (also portaled, z-50): a security
  // confirmation must never render behind the surface that triggered it.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
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
    </div>,
    document.body,
  );
}
