import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { useWebSocket } from "../../store/useWebSocket";
import { getSystemVersion } from "../../api";

/**
 * Full-screen overlay shown during a self-update.
 *
 * Visible when `updateInProgress` is true in the WebSocket store. The actual
 * overlay logic lives in a sub-component so its state is fresh on each open
 * (no need for manual resets).
 */
export function UpdateOverlay() {
  const updateInProgress = useWebSocket((s) => s.updateInProgress);
  if (!updateInProgress) return null;
  return <ActiveOverlay />;
}

function ActiveOverlay() {
  const { t } = useTranslation();
  const wsStatus = useWebSocket((s) => s.status);
  const [showFallback, setShowFallback] = useState(false);
  const originalVersionRef = useRef<string | null>(null);

  // Capture original version + poll for change
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const captureAndPoll = async () => {
      try {
        const info = await getSystemVersion();
        if (cancelled) return;
        originalVersionRef.current = info.current;
      } catch {
        // Sowel may already be down — keep polling, we'll match against any version
      }

      intervalId = setInterval(async () => {
        try {
          const info = await getSystemVersion();
          if (cancelled) return;
          if (
            originalVersionRef.current === null ||
            info.current !== originalVersionRef.current
          ) {
            window.location.reload();
          }
        } catch {
          // Sowel is restarting — keep polling
        }
      }, 3000);
    };

    captureAndPoll();

    // Show fallback "Reload manually" after 3 min — async via setTimeout, not in body
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) setShowFallback(true);
    }, 3 * 60 * 1000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      clearTimeout(fallbackTimer);
    };
  }, []);

  // Belt + suspenders: reload when WS reconnects after the swap
  useEffect(() => {
    if (wsStatus !== "connected") return;
    let cancelled = false;
    getSystemVersion()
      .then((info) => {
        if (cancelled) return;
        if (
          originalVersionRef.current === null ||
          info.current !== originalVersionRef.current
        ) {
          window.location.reload();
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [wsStatus]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center max-w-md px-6">
        <Loader2
          size={56}
          className="animate-spin mx-auto mb-6 text-primary"
          strokeWidth={1.5}
        />
        <h2 className="text-[20px] font-semibold text-text mb-3">
          {t("update.overlayTitle")}
        </h2>
        <p className="text-[14px] text-text-secondary leading-relaxed">
          {t("update.overlayMessage")}
        </p>
        {showFallback && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 flex items-center gap-2 px-4 py-2 mx-auto text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors cursor-pointer"
          >
            <RefreshCw size={14} />
            {t("update.overlayReload")}
          </button>
        )}
      </div>
    </div>
  );
}
