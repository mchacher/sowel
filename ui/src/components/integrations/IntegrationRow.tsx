import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  Timer,
  ChevronRight,
  Cpu,
  Loader2,
  Settings,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { startIntegration, stopIntegration, refreshIntegration } from "../../api";
import type { IntegrationInfo } from "../../types";

interface IntegrationRowProps {
  integration: IntegrationInfo;
  onOpen: () => void;
  onRefresh: () => void;
}

export function IntegrationRow({ integration, onOpen, onRefresh }: IntegrationRowProps) {
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isConnected = integration.status === "connected";
  const isError = integration.status === "error";
  const isNotConfigured = integration.status === "not_configured";
  const hasRefresh = isConnected && !!integration.polling;

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[integration.icon] ?? Cpu;

  const handleAction = async (e: React.MouseEvent, action: "start" | "stop" | "refresh") => {
    e.stopPropagation();
    setActionLoading(action);
    try {
      if (action === "start") await startIntegration(integration.id);
      else if (action === "stop") await stopIntegration(integration.id);
      else if (action === "refresh") await refreshIntegration(integration.id);
      onRefresh();
    } catch {
      // Error handled silently — status will update on refresh
      onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-surface border border-border rounded-[10px] hover:border-primary/30 transition-colors cursor-pointer group"
    >
      {/* Icon */}
      <div className="w-10 h-10 bg-accent/10 rounded-[8px] flex items-center justify-center shrink-0">
        <IconComponent size={20} className="text-accent" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text truncate">{integration.name}</span>
          <StatusBadge status={integration.status} />
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[12px] text-text-tertiary">
            {integration.deviceCount} {t("integrations.devices")}
            {integration.offlineDeviceCount > 0 && (
              <span className="text-warning ml-1">
                ({integration.offlineDeviceCount} off)
              </span>
            )}
          </span>
          {isConnected && integration.polling && (
            <PollCountdown polling={integration.polling} onExpired={onRefresh} />
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1 shrink-0">
        {isNotConfigured ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="p-2 rounded-[6px] text-text-tertiary hover:bg-border-light hover:text-text transition-colors cursor-pointer"
            title={t("integrations.configure")}
          >
            <Settings size={16} />
          </button>
        ) : isConnected ? (
          <>
            <button
              onClick={(e) => handleAction(e, "stop")}
              disabled={actionLoading === "stop"}
              className="p-2 rounded-[6px] text-text-tertiary hover:bg-border-light hover:text-text transition-colors cursor-pointer disabled:opacity-50"
              title={t("integrations.stop")}
            >
              {actionLoading === "stop" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Square size={16} />
              )}
            </button>
            {hasRefresh && (
              <button
                onClick={(e) => handleAction(e, "refresh")}
                disabled={actionLoading === "refresh"}
                className="p-2 rounded-[6px] text-text-tertiary hover:bg-border-light hover:text-text transition-colors cursor-pointer disabled:opacity-50"
                title={t("integrations.refresh")}
              >
                {actionLoading === "refresh" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>
            )}
          </>
        ) : (
          <button
            onClick={(e) => handleAction(e, "start")}
            disabled={actionLoading === "start"}
            className="p-2 rounded-[6px] text-text-tertiary hover:bg-border-light hover:text-success transition-colors cursor-pointer disabled:opacity-50"
            title={t("integrations.start")}
          >
            {actionLoading === "start" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
          </button>
        )}

        {/* Chevron */}
        <ChevronRight
          size={18}
          className="text-text-tertiary group-hover:text-text transition-colors ml-1"
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationInfo["status"] }) {
  const { t } = useTranslation();

  const config = {
    connected: { color: "bg-success/15 text-success", icon: Wifi },
    disconnected: { color: "bg-border text-text-tertiary", icon: WifiOff },
    error: { color: "bg-error/15 text-error", icon: AlertTriangle },
    not_configured: { color: "bg-border text-text-tertiary", icon: WifiOff },
  };

  const { color, icon: Icon } = config[status];
  const label = status === "not_configured" ? "disconnected" : status;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      <Icon size={10} />
      {t(`status.${label}`)}
    </span>
  );
}

function PollCountdown({
  polling,
  onExpired,
}: {
  polling: { lastPollAt: string; intervalMs: number };
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(() => {
    const next = new Date(polling.lastPollAt).getTime() + polling.intervalMs;
    return Math.max(0, Math.round((next - Date.now()) / 1000));
  });

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const next = new Date(polling.lastPollAt).getTime() + polling.intervalMs;
      const secs = Math.max(0, Math.round((next - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0 && !refreshTimer) {
        refreshTimer = setTimeout(onExpired, 3000);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [polling.lastPollAt, polling.intervalMs, onExpired]);

  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const label = min > 0 ? `${min}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;

  return (
    <span className="flex items-center gap-1 text-[11px] text-text-tertiary tabular-nums">
      <Timer size={11} />
      {label}
    </span>
  );
}
