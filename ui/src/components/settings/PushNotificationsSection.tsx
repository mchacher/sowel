import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Bell, BellOff } from "lucide-react";
import { usePushSubscription } from "../../hooks/usePushSubscription";
import { PushDeviceList } from "./PushDeviceList";

// Settings > Account > Notifications (#1199). Every role turns Web Push on or
// off for the device in hand here: subscriptions are per user (spec 127), and
// the browser only grants the permission from a tap, never at install.

export const NOTIFICATIONS_SECTION_ID = "notifications";

export function PushNotificationsSection() {
  const { t } = useTranslation();
  const { status, supported, busy, error, endpoint, subscribe, unsubscribe, refresh } =
    usePushSubscription();
  const sectionRef = useRef<HTMLElement>(null);

  // Coming back from the phone settings (permission allowed there) must update
  // the row without reopening the app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // The publishers page links to `/settings?tab=account#notifications`.
  useEffect(() => {
    if (window.location.hash === `#${NOTIFICATIONS_SECTION_ID}`) {
      sectionRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, []);

  let action: React.ReactNode = null;
  let hint: string | null = null;
  if (!supported || status === "unsupported") {
    hint = t("settings.notifications.unsupported");
  } else if (status === "insecure") {
    hint = t("settings.notifications.insecure");
  } else if (status === "denied") {
    hint = t("settings.notifications.denied");
  } else if (status === "subscribed") {
    action = (
      <button
        onClick={() => void unsubscribe()}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-small rounded-sm border border-border text-text-secondary hover:text-text disabled:opacity-50 shrink-0"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
        {t("settings.notifications.disable")}
      </button>
    );
  } else {
    action = (
      <button
        onClick={() => void subscribe()}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-fill text-white text-small rounded-sm hover:bg-primary-fill-hover disabled:opacity-50 shrink-0"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
        {t("settings.notifications.enable")}
      </button>
    );
  }

  return (
    <section ref={sectionRef} id={NOTIFICATIONS_SECTION_ID} className="card p-5 scroll-mt-4">
      <h2 className="text-body font-semibold text-text mb-1">
        {t("settings.notifications.title")}
      </h2>
      <p className="text-small text-text-secondary mb-4">{t("settings.notifications.intro")}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-small font-medium text-text">
            {t("settings.notifications.thisDevice")}
          </div>
          <div className="text-caption text-text-secondary">
            {status === "subscribed"
              ? t("settings.notifications.on")
              : t("settings.notifications.off")}
          </div>
        </div>
        {action}
      </div>
      {hint && <p className="text-caption text-text-tertiary mt-2">{hint}</p>}
      {error && <p className="text-caption text-error mt-2">{error}</p>}
      <PushDeviceList
        currentEndpoint={endpoint}
        reloadKey={`${status}:${endpoint ?? ""}`}
        onRemoveCurrent={unsubscribe}
      />
    </section>
  );
}
