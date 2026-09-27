import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { changeSharedAccessCode, getSharedAccessJournal } from "../../api";
import type { SharedAccessJournalEntry, SharedAccessState, SharedAccessView } from "../../types";
import { useSharedAccess } from "../../store/useSharedAccess";
import { Invitation } from "./Invitation";
import { useSaFormat } from "./useSaFormat";
import {
  Dialog,
  Refusal,
  btnDanger,
  btnPrimary,
  btnSecondary,
  errorCode,
  useRefusalText,
} from "./ui";

/**
 * R3.9 — one « Changer le code »: a new code (when the access has one) and a
 * new link together, the phones already set up kept (the lost email) or cut
 * off too (the lost phone).
 */
export function ChangeCodeDialog({
  access,
  onClose,
}: {
  access: SharedAccessView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refusalText = useRefusalText();
  const refresh = useSharedAccess((s) => s.refresh);
  const [cutPhones, setCutPhones] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SharedAccessView | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const view = await changeSharedAccessCode(access.id, cutPhones);
      await refresh();
      setDone(view);
    } catch (err) {
      setError(refusalText(errorCode(err)));
    } finally {
      setSaving(false);
    }
  };

  const title = t("sharedAccess.changeCode.title", { label: access.label });
  if (done) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p className="text-[13px] text-success">
          {cutPhones ? t("sharedAccess.changeCode.doneCut") : t("sharedAccess.changeCode.doneKept")}
        </p>
        <Invitation link={done.invitationUrl} code={done.code} />
        <div className="flex justify-end mt-5">
          <button type="button" className={btnPrimary} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-[13px] text-text-secondary mb-3">
        {access.code ? t("sharedAccess.changeCode.intro") : t("sharedAccess.changeCode.introNoCode")}
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("sharedAccess.changeCode.phones")}</legend>
        <label className="flex items-start gap-2 text-[13.5px] text-text cursor-pointer">
          <input
            type="radio"
            name="sa-phones"
            className="mt-1"
            checked={!cutPhones}
            onChange={() => setCutPhones(false)}
          />
          <span>
            {t("sharedAccess.changeCode.keep")}
            <span className="block text-[12px] text-text-tertiary">{t("sharedAccess.changeCode.keepHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13.5px] text-text cursor-pointer">
          <input
            type="radio"
            name="sa-phones"
            className="mt-1"
            checked={cutPhones}
            onChange={() => setCutPhones(true)}
          />
          <span>
            {t("sharedAccess.changeCode.cut", { count: access.phones })}
            <span className="block text-[12px] text-text-tertiary">{t("sharedAccess.changeCode.cutHint")}</span>
          </span>
        </label>
      </fieldset>
      {error && <Refusal>{error}</Refusal>}
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button type="button" className={btnPrimary} onClick={() => void confirm()} disabled={saving}>
          {saving ? t("common.saving") : t("sharedAccess.changeCode.confirm")}
        </button>
      </div>
    </Dialog>
  );
}

/** This access's journal (R7.28) — what happened, newest first. */
export function JournalDialog({
  access,
  state,
  onClose,
}: {
  access: SharedAccessView;
  state: SharedAccessState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useSaFormat();
  const refusalText = useRefusalText();
  const [entries, setEntries] = useState<SharedAccessJournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSharedAccessJournal(access.id)
      .then((list) => alive && setEntries(list))
      .catch((err: unknown) => alive && setError(refusalText(errorCode(err))));
    return () => {
      alive = false;
    };
  }, [access.id, refusalText]);

  const gateName = (id: string | null) =>
    id ? (state.gates.find((g) => g.equipmentId === id)?.name ?? id) : null;

  return (
    <Dialog title={t("sharedAccess.journal.title", { label: access.label })} onClose={onClose} wide>
      {error && <Refusal>{error}</Refusal>}
      {!entries && !error && <Loader2 size={16} className="animate-spin text-text-tertiary" />}
      {entries && entries.length === 0 && (
        <p className="text-[13px] text-text-tertiary">{t("sharedAccess.journal.empty")}</p>
      )}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-border-light max-h-[60vh] overflow-y-auto -mx-1">
          {entries.map((e) => {
            const gate = gateName(e.equipmentId);
            return (
              <li key={e.id} className="flex items-baseline gap-3 px-1 py-2 text-[13px]">
                <span className="font-mono text-[12px] text-text-tertiary tabular-nums shrink-0 w-[112px]">
                  {fmt.dateTime(e.at)}
                </span>
                <span className="min-w-0">
                  <span className={e.kind === "refused" ? "text-error" : "text-text"}>
                    {t(`sharedAccess.journal.kind.${e.kind}`, { defaultValue: e.kind })}
                  </span>
                  {gate && <span className="text-text-secondary"> · {gate}</span>}
                  {e.reason && (
                    <span className="text-text-secondary">
                      {" "}
                      —{" "}
                      {t(`sharedAccess.journal.reason.${e.reason}`, {
                        defaultValue: t(`sharedAccess.refusal.${e.reason}`, { defaultValue: e.reason }),
                      })}
                    </span>
                  )}
                  {e.actor && <span className="text-text-tertiary"> · {e.actor}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end mt-4">
        <button type="button" className={btnSecondary} onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** A yes/no before something that cannot be taken back (revoke, delete). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-[13px] text-text-secondary">{message}</p>
      {error && <Refusal>{error}</Refusal>}
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              onClose();
            } catch (err) {
              setError(refusalText(errorCode(err)));
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
