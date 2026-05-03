import { useWebSocket } from "../../store/useWebSocket";
import { Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Discreet WebSocket connection indicator. Integration-level errors are
 * surfaced through the alarms pill (see AlarmsSheet) — this component
 * is now purely about the WS link to the backend.
 */
export function ConnectionStatus() {
  const { t } = useTranslation();
  const status = useWebSocket((s) => s.status);

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full bg-error/10 text-error">
        <WifiOff size={14} strokeWidth={1.5} />
        <span className="text-[12px] font-medium hidden sm:inline">{t("status.disconnected")}</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full bg-warning/10 text-warning">
        <Wifi size={14} strokeWidth={1.5} className="animate-pulse" />
        <span className="text-[12px] font-medium hidden sm:inline">{t("status.connecting")}</span>
      </div>
    );
  }

  // status === "connected" — mobile: just a green dot, desktop: dot + label.
  return (
    <div className="flex items-center gap-2 sm:px-3 sm:py-1.5 sm:rounded-full sm:bg-success/10">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
      </span>
      <span className="text-[12px] font-medium text-success hidden sm:inline">
        {t("status.connected")}
      </span>
    </div>
  );
}
