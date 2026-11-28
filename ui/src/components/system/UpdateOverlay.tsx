import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useWebSocket, type UpdateFailure } from "../../store/useWebSocket";
import { useAuth } from "../../store/useAuth";
import { getSystemVersion } from "../../api";

/**
 * Full-screen overlay shown during a self-update.
 *
 * Visible when `updateInProgress` is true in the WebSocket store. The actual
 * overlay logic lives in a sub-component so its state is fresh on each open
 * (no need for manual resets).
 *
 * A failed update takes the same slot rather than just dropping the overlay:
 * the spinner vanishing on its own reads exactly like a successful update that
 * forgot to reload, and the reason (a registry timeout, a compose refusal) is
 * the one thing the admin cannot guess.
 */
export function UpdateOverlay() {
  const updateInProgress = useWebSocket((s) => s.updateInProgress);
  const updateFailure = useWebSocket((s) => s.updateFailure);
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  if (updateFailure) return <FailedOverlay failure={updateFailure} showReason={isAdmin} />;
  if (!updateInProgress) return null;
  return <ActiveOverlay />;
}

/**
 * Every role gets the in-progress overlay, so every role has to be told how it
 * ended. Only an admin gets the reason: the server redacts that string for
 * everyone else, and a full-screen "[redacted]" is worse than the outcome
 * alone for someone who cannot act on it anyway.
 */
function FailedOverlay({ failure, showReason }: { failure: UpdateFailure; showReason: boolean }) {
  const { t } = useTranslation();
  const setUpdateFailure = useWebSocket((s) => s.setUpdateFailure);
  const isRestart = failure.operation === "restart";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center max-w-md px-6">
        <AlertTriangle size={56} className="mx-auto mb-6 text-error" strokeWidth={1.5} />
        <h2 className="text-title font-semibold text-text mb-3">
          {t(isRestart ? "update.restartFailedTitle" : "update.failedTitle")}
        </h2>
        {showReason && (
          <p className="text-small font-mono text-text-secondary leading-relaxed break-words text-left bg-background rounded-md p-3">
            {failure.message}
          </p>
        )}
        <p className="mt-3 text-small text-text-secondary leading-relaxed">
          {t(isRestart ? "update.restartFailedHint" : "update.failedHint")}
        </p>
        <button
          onClick={() => setUpdateFailure(null)}
          className="mt-6 px-4 py-2 mx-auto text-small font-medium bg-primary-fill text-white rounded-sm hover:bg-primary-fill-hover transition-colors cursor-pointer"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}

/** Only a known starting version, and a different one, means the swap is done. */
function isNewVersion(original: string | null, current: string): boolean {
  return original !== null && current !== original;
}

function ActiveOverlay() {
  const { t } = useTranslation();
  const wsStatus = useWebSocket((s) => s.status);
  const [showFallback, setShowFallback] = useState(false);
  // The version Sowel runs before the swap. The store already knows it for an
  // update (the pill offered it), so it is set before the first request goes
  // out; a restart has no pending update and learns it from the first answer.
  // While it is unknown nothing reloads: two answers racing at mount, or a
  // phone's WebSocket reconnecting on wake, used to reload the page before
  // the update had even started, and the overlay was gone for good (#1337).
  const originalVersionRef = useRef<string | null>(
    useWebSocket.getState().updateAvailable?.current ?? null,
  );

  // Capture original version + poll for change
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const captureAndPoll = async () => {
      try {
        const info = await getSystemVersion();
        if (cancelled) return;
        originalVersionRef.current ??= info.current;
      } catch {
        // Sowel may already be down: keep polling, the first answer sets it
      }

      intervalId = setInterval(async () => {
        try {
          const info = await getSystemVersion();
          if (cancelled) return;
          if (isNewVersion(originalVersionRef.current, info.current)) window.location.reload();
        } catch {
          // Sowel is restarting — keep polling
        }
      }, 3000);
    };

    captureAndPoll();

    // Show fallback "Reload manually" after 3 min — async via setTimeout, not in body
    const fallbackTimer = setTimeout(
      () => {
        if (!cancelled) setShowFallback(true);
      },
      3 * 60 * 1000,
    );

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
        if (isNewVersion(originalVersionRef.current, info.current)) window.location.reload();
        else originalVersionRef.current ??= info.current;
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
        <Loader2 size={56} className="animate-spin mx-auto mb-6 text-primary" strokeWidth={1.5} />
        <h2 className="text-title font-semibold text-text mb-3">{t("update.overlayTitle")}</h2>
        <p className="text-body text-text-secondary leading-relaxed">
          {t("update.overlayMessage")}
        </p>
        {showFallback && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 flex items-center gap-2 px-4 py-2 mx-auto text-small font-medium bg-primary-fill text-white rounded-sm hover:bg-primary-fill-hover transition-colors cursor-pointer"
          >
            <RefreshCw size={14} />
            {t("update.overlayReload")}
          </button>
        )}
      </div>
    </div>
  );
}
