import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X, Loader2 } from "lucide-react";
import { useWebSocket } from "../../store/useWebSocket";
import { triggerSystemRestart } from "../../api";

/**
 * Floating toast shown when the user changes home location in Settings.
 *
 * A restart is required for Sowel to re-derive `process.env.TZ` from the new
 * coordinates (Node caches the TZ at first Date call, so a live update is
 * impossible).
 *
 * The "Restart now" button uses the same helper container pattern as spec 060
 * self-update — a temporary `docker:25-cli` container recreates the sowel
 * container, which survives the Node process death. The `UpdateOverlay` then
 * takes over and reloads the page on WS reconnect.
 *
 * If Docker is not available or Sowel is not compose-managed, the button
 * shows a manual restart instruction instead.
 */
export function RestartToast({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUpdateInProgress = useWebSocket((s) => s.setUpdateInProgress);

  const handleRestart = async () => {
    setError(null);
    setRestarting(true);
    try {
      await triggerSystemRestart();
      // Trigger the global UpdateOverlay — it will poll for WS reconnect and reload
      setUpdateInProgress(true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setRestarting(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-surface border border-border rounded-[10px] shadow-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <RefreshCw size={18} className="text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-text">
            {t("update.restartRequiredTitle")}
          </h3>
          <p className="text-[12px] text-text-secondary mt-1">
            {t("update.restartRequiredMessage")}
          </p>
          {error && (
            <p className="text-[12px] text-error mt-2">{error}</p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {restarting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {t("update.restartNow")}
            </button>
            <button
              onClick={onClose}
              disabled={restarting}
              className="px-3 py-1.5 text-[12px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer"
            >
              {t("update.later")}
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={restarting}
          className="flex-shrink-0 p-1 text-text-tertiary hover:text-text-secondary rounded-[4px] cursor-pointer"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
