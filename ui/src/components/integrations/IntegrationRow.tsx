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
      onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-[10px] hover:border-primary/30 transition-colors cursor-pointer group"
    >
      {/* Icon */}
      <div className="w-9 h-9 bg-accent/10 rounded-[8px] flex items-center justify-center shrink-0">
        <IconComponent size={18} className="text-accent" />
      </div>

      {/* Name + status */}
      <div className="min-w-0 w-[180px] sm:w-[220px] shrink-0">
        <span className="text-[14px] font-semibold text-text truncate block">
          {integration.name}
        </span>
        <StatusBadge status={integration.status} />
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-4 text-[12px] text-text-tertiary flex-1">
        <span>
          {integration.deviceCount} {t("integrations.devices")}
          {integration.offlineDeviceCount > 0 && (
            <span className="text-warning ml-1">({integration.offlineDeviceCount} off)</span>
          )}
        </span>
        {isConnected && integration.polling && (
          <PollCountdown polling={integration.polling} onExpired={onRefresh} />
        )}
      </div>

      {/* Mobile stats */}
      <div className="flex sm:hidden items-center gap-2 text-[11px] text-text-tertiary flex-1">
        <span>{integration.deviceCount} dev</span>
        {isConnected && integration.polling && (
          <PollCountdown polling={integration.polling} onExpired={onRefresh} />
        )}
      </div>

      {/* Quick actions — visible on hover (desktop), always visible (mobile) */}
      <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {isConnected ? (
          <>
            <QuickAction
              icon={<Square size={14} />}
              loading={actionLoading === "stop"}
              onClick={(e) => handleAction(e, "stop")}
              title={t("integrations.stop")}
            />
            {hasRefresh && (
              <QuickAction
                icon={<RefreshCw size={14} />}
                loading={actionLoading === "refresh"}
                onClick={(e) => handleAction(e, "refresh")}
                title={t("integrations.refresh")}
              />
            )}
          </>
        ) : integration.status !== "not_configured" ? (
          <QuickAction
            icon={<Play size={14} />}
            loading={actionLoading === "start"}
            onClick={(e) => handleAction(e, "start")}
            title={t("integrations.start")}
            accent
          />
        ) : null}
      </div>

      {/* Chevron */}
      <ChevronRight
        size={16}
        className="text-text-tertiary/50 group-hover:text-text-secondary transition-colors shrink-0"
      />
    </div>
  );
}

function QuickAction({
  icon,
  loading,
  onClick,
  title,
  accent,
}: {
  icon: React.ReactNode;
  loading: boolean;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`p-1.5 rounded-[5px] transition-colors cursor-pointer disabled:opacity-50 ${
        accent
          ? "text-success/70 hover:bg-success/10 hover:text-success"
          : "text-text-tertiary hover:bg-border-light hover:text-text-secondary"
      }`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
    </button>
  );
}

function StatusBadge({ status }: { status: IntegrationInfo["status"] }) {
  const { t } = useTranslation();

  const config = {
    connected: { dot: "bg-success", text: "text-success" },
    disconnected: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
    error: { dot: "bg-error", text: "text-error" },
    not_configured: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
  };

  const { dot, text } = config[status];
  const label = status === "not_configured" ? "disconnected" : status;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${text} mt-0.5`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
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
    <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary tabular-nums">
      <Timer size={10} />
      {label}
    </span>
  );
}
