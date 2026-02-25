import { useWebSocket } from "../../store/useWebSocket";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { INTEGRATION_LABELS } from "../../constants";

export function ConnectionStatus() {
  const { t } = useTranslation();
  const status = useWebSocket((s) => s.status);
  const integrationStatuses = useWebSocket((s) => s.integrationStatuses);

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-error/10 text-error">
        <WifiOff size={14} strokeWidth={1.5} />
        <span className="text-[12px] font-medium">{t("status.disconnected")}</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning">
        <Wifi size={14} strokeWidth={1.5} className="animate-pulse" />
        <span className="text-[12px] font-medium">{t("status.connecting")}</span>
      </div>
    );
  }

  // status === "connected" — check if any integration has issues
  const disconnectedNames = Object.entries(integrationStatuses)
    .filter(([, s]) => s === "disconnected" || s === "error")
    .map(([id]) => INTEGRATION_LABELS[id] ?? id);

  if (disconnectedNames.length > 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning">
        <AlertTriangle size={14} strokeWidth={1.5} />
        <span className="text-[12px] font-medium">
          {t("status.integrationWarning", { names: disconnectedNames.join(", ") })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
      </span>
      <span className="text-[12px] font-medium">{t("status.connected")}</span>
    </div>
  );
}
