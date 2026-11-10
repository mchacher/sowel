import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { getPushSubscriptions, renamePushSubscription, deletePushSubscription } from "../../api";
import type { PushSubscription } from "../../types";
import { pushDeviceLabelFromUserAgent } from "../../lib/push-device-label";
import { formatRelativeTime } from "../../lib/format";

// Spec 199 — the user's push devices: name, this-device mark, last delivery,
// rename, remove. « Accepted by the push service » is all a 2xx proves: the
// phone may still not have displayed it.

const LABEL_MAX = 60;

const iconBtn =
  "p-1.5 rounded-sm text-text-tertiary hover:text-text hover:bg-border-light transition-colors disabled:opacity-40";

export function PushDeviceList({
  currentEndpoint,
  reloadKey,
  onRemoveCurrent,
}: {
  /** This browser's endpoint, null when not subscribed here. */
  currentEndpoint: string | null;
  /** Changes when this device subscribes or unsubscribes: reload the list. */
  reloadKey: string;
  /** Removing this device's row also unsubscribes the browser. */
  onRemoveCurrent: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<PushSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await getPushSubscriptions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const nameOf = (d: PushSubscription) =>
    d.label ??
    pushDeviceLabelFromUserAgent(d.userAgent) ??
    t("settings.notifications.unknownDevice");

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveLabel = (d: PushSubscription) =>
    run(d.id, async () => {
      await renamePushSubscription(d.id, draft.trim() || null);
      setEditing(null);
    });

  const remove = (d: PushSubscription) => {
    if (armed !== d.id) return setArmed(d.id);
    setArmed(null);
    void run(d.id, () =>
      d.endpoint === currentEndpoint ? onRemoveCurrent() : deletePushSubscription(d.id),
    );
  };

  if (devices === null && !error) {
    return <Loader2 size={16} className="animate-spin text-text-tertiary mt-4" />;
  }

  return (
    <div className="mt-5">
      <h3 className="text-small font-medium text-text mb-1">
        {t("settings.notifications.devices")}
      </h3>
      {devices && devices.length === 0 && (
        <p className="text-caption text-text-tertiary">{t("settings.notifications.noDevices")}</p>
      )}
      {devices && devices.length > 0 && (
        <ul className="divide-y divide-border-light">
          {devices.map((d) => {
            const isCurrent = d.endpoint === currentEndpoint;
            return (
              <li key={d.id} className="flex items-center gap-2 py-2.5" data-testid="push-device">
                <div className="min-w-0 flex-1">
                  {editing === d.id ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={LABEL_MAX}
                      aria-label={t("settings.notifications.rename")}
                      placeholder={pushDeviceLabelFromUserAgent(d.userAgent) ?? ""}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveLabel(d);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="w-full px-2 py-1 text-small bg-background border border-border rounded-sm text-text focus:outline-none focus:border-primary"
                    />
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-small font-medium text-text truncate">{nameOf(d)}</span>
                      {isCurrent && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-primary-light text-primary text-micro font-medium">
                          {t("settings.notifications.thisDevice")}
                        </span>
                      )}
                    </div>
                  )}
                  <DeliveryLine device={d} />
                </div>
                {editing === d.id ? (
                  <>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={busy !== null}
                      aria-label={t("common.save")}
                      onClick={() => void saveLabel(d)}
                    >
                      <Check size={16} strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      aria-label={t("common.cancel")}
                      onClick={() => setEditing(null)}
                    >
                      <X size={16} strokeWidth={1.5} />
                    </button>
                  </>
                ) : armed === d.id ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => remove(d)}
                    className="px-2 py-1 text-small font-medium text-error border border-error/40 rounded-sm hover:bg-error/10 disabled:opacity-50 shrink-0"
                  >
                    {t("settings.notifications.confirmRemove")}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={busy !== null}
                      aria-label={t("settings.notifications.rename")}
                      onClick={() => {
                        setArmed(null);
                        setEditing(d.id);
                        setDraft(d.label ?? "");
                      }}
                    >
                      <Pencil size={16} strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={busy !== null}
                      aria-label={t("settings.notifications.remove")}
                      onClick={() => remove(d)}
                    >
                      {busy === d.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} strokeWidth={1.5} />
                      )}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </div>
  );
}

function DeliveryLine({ device }: { device: PushSubscription }) {
  const { t } = useTranslation();
  if (device.lastError) {
    return (
      <p className="text-caption text-error break-words">
        {t("settings.notifications.lastFailed", {
          when: formatRelativeTime(device.lastSentAt ?? null),
          error: device.lastError,
        })}
      </p>
    );
  }
  if (device.lastSuccessAt) {
    return (
      <p className="text-caption text-text-secondary">
        {t("settings.notifications.lastAccepted", {
          when: formatRelativeTime(device.lastSuccessAt),
        })}
      </p>
    );
  }
  return <p className="text-caption text-text-tertiary">{t("settings.notifications.neverSent")}</p>;
}
