import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, MoreHorizontal, Pause, Pencil, Play, Plug } from "lucide-react";
import { deleteSharedAccess, sharedAccessAction } from "../../api";
import type { SharedAccessState, SharedAccessView } from "../../types";
import { useSharedAccess } from "../../store/useSharedAccess";
import { formatRelative } from "../../lib/format-relative";
import { ChangeCodeDialog, ConfirmDialog, JournalDialog } from "./AccessDialogs";
import { CopyButton } from "./Invitation";
import { pluginName } from "./helpers";
import { useSaFormat } from "./useSaFormat";
import { Refusal, StatusBadge, errorCode, iconBtn, useRefusalText } from "./ui";

type Open = null | "menu" | "code" | "journal" | "revoke" | "delete";

/**
 * R7.28 — one access: label, code, validity, hours, phones, last use, and
 * Sowel's icons for copy the link, edit, hold / resume, and « ⋯ » for change
 * the code, the journal, revoke — or delete, once revoked or ended.
 */
export function AccessRow({
  access,
  state,
  showGates,
  onEdit,
}: {
  access: SharedAccessView;
  state: SharedAccessState;
  showGates: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useSaFormat();
  const refusalText = useRefusalText();
  const refresh = useSharedAccess((s) => s.refresh);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoked = access.status === "revoked";
  const ended = access.status === "ended";
  const suspended = access.suspendedAt !== null;
  const canDelete = revoked || ended;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(refusalText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  };

  const src = access.kind === "external" ? access.source : null;

  return (
    <li
      className={`bg-surface border border-border rounded-[10px] px-3 py-2.5 ${
        revoked || ended ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-text truncate">{access.label}</span>
            <StatusBadge status={access.status} />
            {src && (
              <span className="inline-flex items-center gap-1 text-[11.5px] rounded-full px-2 py-0.5 bg-primary-light text-primary">
                <Plug size={11} strokeWidth={1.5} />
                {src.profileName
                  ? t("sharedAccess.line.sourceWithProfile", {
                      plugin: pluginName(state, src.pluginId),
                      profile: src.profileName,
                    })
                  : pluginName(state, src.pluginId)}
              </span>
            )}
          </div>
          <div className="text-[12px] text-text-secondary mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {access.code ? (
              <span className="inline-flex items-center gap-0.5">
                <span className="font-mono font-semibold tracking-[0.06em] text-text">{access.code}</span>
                <CopyButton text={access.code} label={t("sharedAccess.actions.copyCode")} />
              </span>
            ) : (
              <span className="text-text-tertiary">{t("sharedAccess.line.linkOnly")}</span>
            )}
            <span>· {fmt.period(access.validFrom, access.validUntil)}</span>
            <span>· {fmt.hours(access.timeWindows)}</span>
            <span>· {t("sharedAccess.line.phones", { count: access.phones })}</span>
            <span>
              ·{" "}
              {access.lastUsedAt ? (
                <>
                  {t("sharedAccess.line.lastUse")}{" "}
                  {t("reading.ago", { age: formatRelative(access.lastUsedAt, t) })}
                </>
              ) : (
                t("sharedAccess.line.neverUsed")
              )}
            </span>
            {showGates && (
              <span>
                · {access.gates.length ? access.gates.map((g) => g.name).join(", ") : t("sharedAccess.status.no_gate")}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center shrink-0 relative">
          {access.invitationUrl ? (
            <CopyButton
              text={access.invitationUrl}
              label={t("sharedAccess.actions.copyLink")}
              icon={<Link2 size={16} strokeWidth={1.5} />}
            />
          ) : (
            <button
              type="button"
              className={iconBtn}
              disabled
              aria-label={t("sharedAccess.actions.copyLink")}
              title={t("sharedAccess.header.noPublicUrl")}
            >
              <Link2 size={16} strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            className={iconBtn}
            onClick={onEdit}
            disabled={revoked || busy}
            aria-label={t("sharedAccess.actions.edit")}
            title={t("sharedAccess.actions.edit")}
          >
            <Pencil size={16} strokeWidth={1.5} />
          </button>
          {!revoked && !ended && (
            <button
              type="button"
              className={iconBtn}
              disabled={busy}
              onClick={() =>
                void act(() => sharedAccessAction(access.id, suspended ? "resume" : "suspend"))
              }
              aria-label={suspended ? t("sharedAccess.actions.resume") : t("sharedAccess.actions.hold")}
              title={suspended ? t("sharedAccess.actions.resume") : t("sharedAccess.actions.hold")}
            >
              {suspended ? <Play size={16} strokeWidth={1.5} /> : <Pause size={16} strokeWidth={1.5} />}
            </button>
          )}
          <button
            type="button"
            className={iconBtn}
            onClick={() => setOpen(open === "menu" ? null : "menu")}
            aria-label={t("sharedAccess.actions.more")}
            aria-haspopup="menu"
            aria-expanded={open === "menu"}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
          {open === "menu" && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(null)} />
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-40 min-w-[210px] bg-surface border border-border rounded-[10px] shadow-lg py-1 text-[13px]"
              >
                {!revoked && (
                  <MenuItem onClick={() => setOpen("code")}>{t("sharedAccess.actions.changeCode")}</MenuItem>
                )}
                <MenuItem onClick={() => setOpen("journal")}>{t("sharedAccess.actions.journal")}</MenuItem>
                {!revoked && (
                  <MenuItem danger onClick={() => setOpen("revoke")}>
                    {t("sharedAccess.actions.revoke")}
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem danger onClick={() => setOpen("delete")}>
                    {t("common.delete")}
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {error && <Refusal>{error}</Refusal>}

      {open === "code" && <ChangeCodeDialog access={access} onClose={() => setOpen(null)} />}
      {open === "journal" && (
        <JournalDialog access={access} state={state} onClose={() => setOpen(null)} />
      )}
      {open === "revoke" && (
        <ConfirmDialog
          title={t("sharedAccess.revoke.title", { label: access.label })}
          message={t("sharedAccess.revoke.message")}
          confirmLabel={t("sharedAccess.actions.revoke")}
          onConfirm={async () => {
            await sharedAccessAction(access.id, "revoke");
            await refresh();
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title={t("sharedAccess.delete.title", { label: access.label })}
          message={t("sharedAccess.delete.message")}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            await deleteSharedAccess(access.id);
            await refresh();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </li>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full text-left px-3 py-2 hover:bg-border-light cursor-pointer ${
        danger ? "text-error" : "text-text"
      }`}
    >
      {children}
    </button>
  );
}
