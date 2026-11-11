import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type Hls from "hls.js";
import {
  Camera,
  RefreshCw,
  Video,
  VideoOff,
  ShieldCheck,
  ShieldOff,
  Siren,
  Lightbulb,
  WifiOff,
} from "lucide-react";
import type {
  DataBindingWithValue,
  OrderBindingWithDetails,
  DataCategory,
  OrderCategory,
} from "../../types";
import { getCameraStreamUrl, getAccessToken } from "../../api";
import { useCameraSnapshot } from "../../hooks/useCameraSnapshot";
import { RelativeTime } from "../RelativeTime";

interface CameraPanelProps {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  equipmentId: string;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

const SNAPSHOT_REFRESH_MS = 30_000;
// How long to wait for the first frame before treating live view as
// failed, even if neither hls.js nor the <video> element raised an
// error — added 2026-08-04 after live view stayed on an indefinite black
// frame on Android Chrome with no error signal at all.
const LIVE_START_TIMEOUT_MS = 12_000;

/**
 * hls.js (about 560 KB) is only fetched when a live view starts, never with
 * the first page load (#1187). The import is memoised by the module system,
 * so a second live view reuses it.
 */
function loadHls(): Promise<typeof Hls> {
  return import("hls.js").then((m) => m.default);
}

export function CameraPanel({
  dataBindings,
  orderBindings,
  equipmentId,
  onExecuteOrder,
}: CameraPanelProps) {
  const { t } = useTranslation();

  const dataByCategory = new Map<DataCategory, DataBindingWithValue>();
  for (const b of dataBindings) {
    if (!dataByCategory.has(b.category)) dataByCategory.set(b.category, b);
  }
  const orderByCategory = new Map<OrderCategory, OrderBindingWithDetails>();
  for (const o of orderBindings) {
    if (o.category && !orderByCategory.has(o.category)) orderByCategory.set(o.category, o);
  }

  const hasSnapshot = dataByCategory.has("camera_snapshot_url");
  const hasStream = dataByCategory.has("camera_stream_url");
  const monitoringBinding = dataByCategory.get("camera_monitoring");
  const monitoringOrder = orderByCategory.get("set_camera_monitoring");
  const lightModeBinding = dataByCategory.get("camera_light_mode");
  const lightModeOrder = orderByCategory.get("set_camera_light_mode");
  const sirenOrder = orderByCategory.get("trigger_camera_siren");
  const detectionBinding = dataByCategory.get("camera_detection");

  const hasAnything =
    hasSnapshot ||
    hasStream ||
    monitoringBinding ||
    lightModeBinding ||
    sirenOrder ||
    detectionBinding;

  if (!hasAnything) {
    return (
      <div className="card p-4 mb-6">
        <h3 className="text-body font-semibold text-text flex items-center gap-2 mb-2">
          <Camera size={16} strokeWidth={1.5} className="text-text-tertiary" />
          {t("cameras.panel.title")}
        </h3>
        <p className="text-small text-text-tertiary">{t("cameras.panel.noData")}</p>
      </div>
    );
  }

  return (
    <div className="card p-4 mb-6 space-y-4">
      <h3 className="text-body font-semibold text-text flex items-center gap-2">
        <Camera size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("cameras.panel.title")}
      </h3>

      {(hasSnapshot || hasStream) && (
        <CameraView equipmentId={equipmentId} hasSnapshot={hasSnapshot} hasStream={hasStream} />
      )}

      {(monitoringOrder || (lightModeOrder && lightModeBinding) || sirenOrder) && (
        <div className="flex flex-wrap items-center gap-2">
          {monitoringOrder && (
            <button
              onClick={() =>
                void onExecuteOrder(monitoringOrder.alias, !(monitoringBinding?.value === true))
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium border transition-colors duration-150 ${
                monitoringBinding?.value === true
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-border-light text-text-secondary border-border"
              }`}
            >
              {monitoringBinding?.value === true ? (
                <ShieldCheck size={14} strokeWidth={1.5} />
              ) : (
                <ShieldOff size={14} strokeWidth={1.5} />
              )}
              {monitoringBinding?.value === true
                ? t("cameras.monitoring.on")
                : t("cameras.monitoring.off")}
            </button>
          )}

          {lightModeOrder && lightModeBinding && (
            <div className="inline-flex items-center gap-1.5 text-small text-text-secondary">
              <Lightbulb size={14} strokeWidth={1.5} className="text-text-tertiary" />
              <select
                value={String(lightModeBinding.value ?? "auto")}
                onChange={(e) => void onExecuteOrder(lightModeOrder.alias, e.target.value)}
                className="bg-bg border border-border rounded-sm px-2 py-1.5"
              >
                <option value="auto">{t("cameras.lightMode.auto")}</option>
                <option value="on">{t("cameras.lightMode.on")}</option>
                <option value="off">{t("cameras.lightMode.off")}</option>
              </select>
            </div>
          )}

          {sirenOrder && (
            <button
              onClick={() => void onExecuteOrder(sirenOrder.alias, true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium border border-error/30 bg-error/10 text-error transition-colors duration-150 hover:bg-error/20"
            >
              <Siren size={14} strokeWidth={1.5} />
              {t("cameras.siren.trigger")}
            </button>
          )}
        </div>
      )}

      {detectionBinding && detectionBinding.value != null && (
        <p className="text-small text-text-secondary">
          {t("cameras.lastDetection")}
          {": "}
          <span className="font-medium text-text">{String(detectionBinding.value)}</span>
          {detectionBinding.lastUpdated && (
            <>
              {" · "}
              <RelativeTime iso={detectionBinding.lastUpdated} />
            </>
          )}
        </p>
      )}
    </div>
  );
}

interface CameraViewProps {
  equipmentId: string;
  hasSnapshot: boolean;
  hasStream: boolean;
}

/**
 * Snapshot thumbnail (blob-fetched — a plain <img src> can't carry the
 * Authorization header) + an on-demand live view (hls.js, header injected
 * per-request via xhrSetup). Live view is opt-in per view (not autostart)
 * to stay polite on bandwidth — matches spec 133's "no server-side
 * transcoding, revisit if a vendor needs it" stance.
 */
function CameraView({ equipmentId, hasSnapshot, hasStream }: CameraViewProps) {
  const { t } = useTranslation();
  const [live, setLive] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [liveRetryTick, setLiveRetryTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const {
    url: snapshotUrl,
    error: snapshotError,
    refresh: refreshSnapshot,
  } = useCameraSnapshot(equipmentId, hasSnapshot && !live, SNAPSHOT_REFRESH_MS);

  useEffect(() => {
    if (!live || !videoRef.current) return;

    const video = videoRef.current;
    let startedPlaying = false;
    let cancelled = false;
    let hls: Hls | null = null;
    let startTimeout: ReturnType<typeof setTimeout> | undefined;

    // The <video> element's own error event catches failures below
    // hls.js's abstraction (e.g. a codec/decode error MSE surfaces
    // directly on the element) that the ERROR event below might not.
    const onVideoError = () => {
      console.error("[camera] <video> element error", {
        equipmentId,
        code: video.error?.code,
        message: video.error?.message,
      });
      setLiveError(true);
    };
    const onPlaying = () => {
      startedPlaying = true;
    };

    loadHls().then(
      (HlsClass) => {
        if (cancelled) return;
        // Browser capability check, made once the library is here. An
        // unsupported browser gets the same error and retry affordance as a
        // failed stream.
        if (!HlsClass.isSupported()) {
          setLiveError(true);
          return;
        }

        hls = new HlsClass({
          xhrSetup: (xhr) => {
            const token = getAccessToken();
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          },
        });
        hlsRef.current = hls;

        // Log every hls.js error, not just fatal ones — on Android this
        // reportedly stays on a black frame with no visible error at all,
        // which only happens if hls.js is hitting something it doesn't
        // consider fatal (or the video never starts for an unrelated
        // reason the ERROR event never fires for). Logging non-fatal errors
        // costs nothing and is the only lead we have without direct device
        // console access.
        hls.on(HlsClass.Events.ERROR, (_event, data) => {
          console.warn("[camera] hls.js error", {
            equipmentId,
            type: data.type,
            details: data.details,
            fatal: data.fatal,
            reason: (data as { response?: { code?: number } }).response?.code,
          });
          if (data.fatal) setLiveError(true);
        });

        video.addEventListener("error", onVideoError);
        video.addEventListener("playing", onPlaying);

        hls.loadSource(getCameraStreamUrl(equipmentId));
        hls.attachMedia(video);

        // Belt-and-suspenders: if nothing has actually started playing within
        // this window, treat it as failed even if neither hls.js nor the
        // <video> element ever raised an error — better an explicit retry
        // affordance than an indefinite black frame.
        startTimeout = setTimeout(() => {
          if (!startedPlaying) {
            console.warn("[camera] live view: no frame started playing within timeout", {
              equipmentId,
              timeoutMs: LIVE_START_TIMEOUT_MS,
            });
            setLiveError(true);
          }
        }, LIVE_START_TIMEOUT_MS);
      },
      (err: unknown) => {
        // The chunk could not be fetched (offline, or a deploy replaced it).
        if (cancelled) return;
        console.warn("[camera] could not load hls.js", { equipmentId, err });
        setLiveError(true);
      },
    );

    return () => {
      cancelled = true;
      clearTimeout(startTimeout);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("playing", onPlaying);
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [equipmentId, live, liveRetryTick]);

  return (
    <div className="space-y-2">
      <div className="relative bg-black rounded-sm overflow-hidden aspect-video flex items-center justify-center">
        {live ? (
          liveError ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <WifiOff size={28} strokeWidth={1.5} className="text-error" />
              <p className="text-small font-medium text-white">{t("cameras.live.error")}</p>
              <button
                onClick={() => {
                  setLiveError(false);
                  setLiveRetryTick((n) => n + 1);
                }}
                className="text-caption font-medium text-primary hover:underline"
              >
                {t("cameras.live.retry")}
              </button>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-contain"
            />
          )
        ) : snapshotUrl ? (
          <img src={snapshotUrl} alt="" className="w-full h-full object-contain" />
        ) : snapshotError ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <WifiOff size={28} strokeWidth={1.5} className="text-error" />
            <p className="text-small font-medium text-white">{t("cameras.snapshot.error")}</p>
            <button
              onClick={refreshSnapshot}
              className="text-caption font-medium text-primary hover:underline"
            >
              {t("cameras.snapshot.retry")}
            </button>
          </div>
        ) : (
          <Camera size={28} strokeWidth={1.5} className="text-white/40" />
        )}
      </div>

      <div className="flex items-center gap-2">
        {hasSnapshot && !live && (
          <button
            onClick={refreshSnapshot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium text-text-secondary border border-border hover:bg-border-light transition-colors duration-150"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
            {t("cameras.snapshot.refresh")}
          </button>
        )}
        {hasStream && (
          <button
            onClick={() => {
              if (!live) setLiveError(false);
              setLive((v) => !v);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium border transition-colors duration-150 ${
              live
                ? "bg-error/10 text-error border-error/30"
                : "bg-primary/10 text-primary border-primary/30"
            }`}
          >
            {live ? (
              <VideoOff size={14} strokeWidth={1.5} />
            ) : (
              <Video size={14} strokeWidth={1.5} />
            )}
            {live ? t("cameras.live.stop") : t("cameras.live.start")}
          </button>
        )}
      </div>
    </div>
  );
}
