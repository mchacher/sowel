import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square, RefreshCw, Timer, ChevronRight, Loader2, Power } from "lucide-react";
import { PluginIcon } from "../plugins/PluginIcon";
import {
  startIntegration,
  stopIntegration,
  refreshIntegration,
  enablePlugin,
  disablePlugin,
} from "../../api";
import type { IntegrationInfo } from "../../types";
import { formatDuration } from "../../lib/format";

interface IntegrationRowProps {
  integration: IntegrationInfo;
  onOpen: () => void;
  onRefresh: () => void;
}

export function IntegrationRow({ integration, onOpen, onRefresh }: IntegrationRowProps) {
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isDisabled = integration.enabled === false;
  const isConnected = !isDisabled && integration.status === "connected";
  const hasRefresh = isConnected && !!integration.polling;

  const handleAction = async (
    e: React.MouseEvent,
    action: "start" | "stop" | "refresh" | "enable" | "disable",
  ) => {
    e.stopPropagation();
    setActionLoading(action);
    try {
      if (action === "start") await startIntegration(integration.id);
      else if (action === "stop") await stopIntegration(integration.id);
      else if (action === "refresh") await refreshIntegration(integration.id);
      else if (action === "enable") await enablePlugin(integration.id);
      else if (action === "disable") await disablePlugin(integration.id);
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
      className="card flex items-center gap-3 px-4 py-3 hover:shadow-md transition-shadow cursor-pointer group"
    >
      {/* Icon */}
      <div className="w-9 h-9 bg-border-light rounded-md flex items-center justify-center shrink-0">
        <PluginIcon name={integration.icon} size={18} className="text-text-secondary" />
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1 sm:flex-none sm:w-[220px] sm:shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold text-text truncate">{integration.name}</span>
          {integration.pluginVersion && (
            <span className="text-micro px-1.5 py-0.5 bg-border-light rounded-sm text-text-tertiary font-mono shrink-0">
              {integration.pluginVersion}
            </span>
          )}
        </div>
        <StatusBadge status={integration.status} disabled={isDisabled} />
        {/* Mobile stats — under the status, inside the name column */}
        <div className="flex sm:hidden items-center gap-1.5 text-micro text-text-tertiary mt-0.5 whitespace-nowrap">
          <span>{t("integrations.deviceCount", { count: integration.deviceCount })}</span>
          {isConnected && integration.polling && (
            <>
              <span aria-hidden="true">·</span>
              <PollCountdown polling={integration.polling} onExpired={onRefresh} />
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-4 text-caption text-text-tertiary flex-1">
        <span>
          {t("integrations.deviceCount", { count: integration.deviceCount })}
          {integration.offlineDeviceCount > 0 && (
            <span className="text-warning-ink ml-1">
              {t("integrations.offlineCount", { count: integration.offlineDeviceCount })}
            </span>
          )}
        </span>
        {isConnected && integration.polling && (
          <PollCountdown polling={integration.polling} onExpired={onRefresh} />
        )}
      </div>

      {/* Quick actions — desktop only; on phones they live in the drawer opened by a tap on the row */}
      <div className="hidden sm:flex items-center gap-0.5 shrink-0">
        {isDisabled ? (
          <QuickAction
            icon={<Power size={14} />}
            loading={actionLoading === "enable"}
            onClick={(e) => handleAction(e, "enable")}
            title={t("integrations.enable")}
            accent
          />
        ) : isConnected ? (
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
            <QuickAction
              icon={<Power size={14} />}
              loading={actionLoading === "disable"}
              onClick={(e) => handleAction(e, "disable")}
              title={t("integrations.disable")}
            />
          </>
        ) : integration.status !== "not_configured" ? (
          <>
            <QuickAction
              icon={<Play size={14} />}
              loading={actionLoading === "start"}
              onClick={(e) => handleAction(e, "start")}
              title={t("integrations.start")}
              accent
            />
            <QuickAction
              icon={<Power size={14} />}
              loading={actionLoading === "disable"}
              onClick={(e) => handleAction(e, "disable")}
              title={t("integrations.disable")}
            />
          </>
        ) : (
          <QuickAction
            icon={<Power size={14} />}
            loading={actionLoading === "disable"}
            onClick={(e) => handleAction(e, "disable")}
            title={t("integrations.disable")}
          />
        )}
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
      className={`p-1.5 rounded-sm transition-colors cursor-pointer disabled:opacity-50 ${
        accent
          ? "text-success/70 hover:bg-success/10 hover:text-success"
          : "text-text-tertiary hover:bg-border-light hover:text-text-secondary"
      }`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
    </button>
  );
}

function StatusBadge({
  status,
  disabled,
}: {
  status: IntegrationInfo["status"];
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-micro text-text-tertiary mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
        {t("integrations.disabledStatus")}
      </span>
    );
  }

  const config = {
    connected: { dot: "bg-success", text: "text-success" },
    disconnected: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
    error: { dot: "bg-error", text: "text-error" },
    not_configured: { dot: "bg-text-tertiary", text: "text-text-tertiary" },
  };

  const { dot, text } = config[status];
  const label = status === "not_configured" ? "disconnected" : status;

  return (
    <span className={`inline-flex items-center gap-1.5 text-micro ${text} mt-0.5`}>
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

  const label = formatDuration(remaining);

  return (
    <span className="inline-flex items-center gap-1 text-micro text-text-tertiary tabular-nums">
      <Timer size={10} />
      {label}
    </span>
  );
}
