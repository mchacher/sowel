import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  changeSharedAccessCode,
  cutSharedAccessPhone,
  getSharedAccessJournal,
  getSharedAccessPhones,
} from "../../api";
import type {
  SharedAccessJournalEntry,
  SharedAccessPhoneView,
  SharedAccessState,
  SharedAccessView,
} from "../../types";
import { formatRelative } from "../../lib/format-relative";
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
        {access.code
          ? t("sharedAccess.changeCode.intro")
          : t("sharedAccess.changeCode.introNoCode")}
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
            <span className="block text-[12px] text-text-tertiary">
              {t("sharedAccess.changeCode.keepHint")}
            </span>
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
            <span className="block text-[12px] text-text-tertiary">
              {t("sharedAccess.changeCode.cutHint")}
            </span>
          </span>
        </label>
      </fieldset>
      {error && <Refusal>{error}</Refusal>}
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void confirm()}
          disabled={saving}
        >
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
                  {e.phoneTag && (
                    <span className="text-text-secondary">
                      {" "}
                      · {t("sharedAccess.phones.tagOnly", { tag: e.phoneTag })}
                    </span>
                  )}
                  {e.reason && (
                    <span className="text-text-secondary">
                      {" "}
                      —{" "}
                      {t(`sharedAccess.journal.reason.${e.reason}`, {
                        defaultValue: t(`sharedAccess.refusal.${e.reason}`, {
                          defaultValue: e.reason,
                        }),
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

/**
 * R5.23 — the phones set up on this access, each named by its platform and a
 * tag drawn from its id (« iPhone · 7K3F »), and each can be cut on its own.
 */
export function PhonesDialog({
  access,
  onClose,
}: {
  access: SharedAccessView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useSaFormat();
  const refusalText = useRefusalText();
  const refresh = useSharedAccess((s) => s.refresh);
  const [phones, setPhones] = useState<SharedAccessPhoneView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSharedAccessPhones(access.id)
      .then((list) => alive && setPhones(list))
      .catch((err: unknown) => alive && setError(refusalText(errorCode(err))));
    return () => {
      alive = false;
    };
  }, [access.id, refusalText]);

  // The second click confirms; the first only arms, for three seconds.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const cut = async (phone: SharedAccessPhoneView) => {
    if (armed !== phone.id) {
      setArmed(phone.id);
      return;
    }
    setArmed(null);
    setBusy(phone.id);
    setError(null);
    try {
      await cutSharedAccessPhone(access.id, phone.id);
      setPhones((list) => (list ?? []).filter((p) => p.id !== phone.id));
      await refresh();
    } catch (err) {
      setError(refusalText(errorCode(err)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={t("sharedAccess.phones.title", { label: access.label })} onClose={onClose}>
      {error && <Refusal>{error}</Refusal>}
      {!phones && !error && <Loader2 size={16} className="animate-spin text-text-tertiary" />}
      {phones && phones.length === 0 && (
        <p className="text-[13px] text-text-tertiary">{t("sharedAccess.phones.empty")}</p>
      )}
      {phones && phones.length > 0 && (
        <ul className="divide-y divide-border-light max-h-[60vh] overflow-y-auto -mx-1">
          {phones.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-1 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-text">
                  {t(`sharedAccess.phones.platform.${p.platform}`)}{" "}
                  <span className="font-mono tracking-[0.06em]">· {p.tag}</span>
                </div>
                <div className="text-[12px] text-text-secondary">
                  {t("sharedAccess.phones.since", { date: fmt.dateTime(p.firstSeenAt) })} ·{" "}
                  {t("sharedAccess.phones.seen", { age: formatRelative(p.lastSeenAt, t) })}
                </div>
              </div>
              <button
                type="button"
                className={armed === p.id ? btnDanger : btnSecondary}
                disabled={busy !== null}
                onClick={() => void cut(p)}
              >
                {armed === p.id
                  ? t("sharedAccess.phones.confirmCut")
                  : t("sharedAccess.phones.cut")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-text-tertiary mt-3">{t("sharedAccess.phones.hint")}</p>
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
