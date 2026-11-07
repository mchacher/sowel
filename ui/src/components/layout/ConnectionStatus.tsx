import { useEffect, useState } from "react";
import { useWebSocket } from "../../store/useWebSocket";
import { Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

/** How long the link must stay down before the indicator shows (spec 196, FR-6). */
export const DEGRADED_DELAY_MS = 3_000;

/**
 * WebSocket link indicator, shown only when the link is degraded (spec 196,
 * FR-6): nothing while connected, and nothing during the first 3 s of a
 * reconnection either, so the routine disconnected → connecting → connected
 * cycle (and the first render, before the socket opens) does not flash in the
 * top bar. Integration-level errors go through the alarms pill (AlarmsSheet).
 */
export function ConnectionStatus() {
  const { t } = useTranslation();
  const status = useWebSocket((s) => s.status);
  const degraded = status !== "connected";
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!degraded) return;
    const id = setTimeout(() => setLate(true), DEGRADED_DELAY_MS);
    return () => {
      clearTimeout(id);
      setLate(false);
    };
  }, [degraded]);

  if (!degraded || !late) return null;

  const disconnected = status === "disconnected";
  const label = disconnected ? t("status.disconnected") : t("status.connecting");
  const Icon = disconnected ? WifiOff : Wifi;

  // Icon only below lg, in a 44 px box; icon and word on desktop.
  return (
    <div
      role="status"
      aria-label={label}
      title={label}
      className={`flex items-center justify-center gap-1.5 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 text-caption font-medium ${
        disconnected ? "text-error" : "text-warning-ink"
      }`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span className="hidden lg:inline" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
