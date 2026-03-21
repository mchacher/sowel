import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Wifi,
  WifiOff,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  Loader2,
  Cpu,
  Timer,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import {
  updateSettings,
  startIntegration,
  stopIntegration,
  restartIntegration,
  refreshIntegration,
} from "../../api";
import type { IntegrationInfo, IntegrationSettingDef } from "../../types";

interface IntegrationDrawerProps {
  integration: IntegrationInfo | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function IntegrationDrawer({ integration, onClose, onRefresh }: IntegrationDrawerProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Reset form when integration changes — fill defaults for empty fields
  useEffect(() => {
    if (integration) {
      const merged = { ...integration.settingValues };
      for (const s of integration.settings) {
        if (s.defaultValue && !merged[s.key]) {
          merged[s.key] = s.defaultValue;
        }
      }
      setValues(merged);
      setDirty(false);
      setMessage(null);
    }
  }, [integration]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (integration) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [integration, onClose]);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  if (!integration) return null;

  const isConnected = integration.status === "connected";
  const isError = integration.status === "error";
  const hasRefresh = !!integration.polling;
  const hasRequiredEmpty = integration.settings.some(
    (s) => s.required && !values[s.key]?.trim(),
  );

  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[integration.icon] ?? Cpu;

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const PASSWORD_MASK = "••••••••";
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        const setting = integration.settings.find((s) => s.key === key);
        if (setting?.type === "password" && value === PASSWORD_MASK) continue;
        entries[`integration.${integration.id}.${key}`] = value;
      }
      await updateSettings(entries);
      setDirty(false);
      if (isConnected) {
        await restartIntegration(integration.id);
        showMessage("success", t("integrations.savedRestarted"));
      } else {
        showMessage("success", t("integrations.saved"));
      }
      onRefresh();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action: "start" | "stop" | "restart" | "refresh") => {
    setActionLoading(action);
    try {
      switch (action) {
        case "start":
          await startIntegration(integration.id);
          showMessage("success", t("integrations.started"));
          break;
        case "stop":
          await stopIntegration(integration.id);
          showMessage("success", t("integrations.stopped"));
          break;
        case "restart":
          await restartIntegration(integration.id);
          showMessage("success", t("integrations.restarted"));
          break;
        case "refresh":
          await refreshIntegration(integration.id);
          showMessage("success", t("integrations.refreshed"));
          break;
      }
      onRefresh();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : t("common.error"));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-surface border-l border-border shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-accent/10 rounded-[8px] flex items-center justify-center">
              <IconComponent size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-text">{integration.name}</h2>
              <p className="text-[12px] text-text-tertiary">{integration.description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-border-light transition-colors cursor-pointer"
          >
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Status cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-background rounded-[8px] p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {isConnected ? (
                  <Wifi size={14} className="text-success" />
                ) : isError ? (
                  <AlertTriangle size={14} className="text-error" />
                ) : (
                  <WifiOff size={14} className="text-text-tertiary" />
                )}
              </div>
              <div
                className={`text-[13px] font-medium ${isConnected ? "text-success" : isError ? "text-error" : "text-text-tertiary"}`}
              >
                {t(
                  `status.${integration.status === "not_configured" ? "disconnected" : integration.status}`,
                )}
              </div>
            </div>
            <div className="bg-background rounded-[8px] p-3 text-center">
              <div className="text-[20px] font-semibold text-text tabular-nums">
                {integration.deviceCount}
              </div>
              <div className="text-[11px] text-text-tertiary">
                {t("integrations.devices")}
                {integration.offlineDeviceCount > 0 && (
                  <span className="text-warning ml-1">
                    ({integration.offlineDeviceCount} off)
                  </span>
                )}
              </div>
            </div>
            <div className="bg-background rounded-[8px] p-3 text-center">
              {integration.polling ? (
                <>
                  <div className="flex items-center justify-center gap-1 text-[13px] font-medium text-text tabular-nums">
                    <Timer size={12} className="text-text-tertiary" />
                    {Math.round(integration.polling.intervalMs / 1000)}s
                  </div>
                  <div className="text-[11px] text-text-tertiary">{t("integrations.polling")}</div>
                </>
              ) : (
                <>
                  <div className="text-[13px] font-medium text-text-tertiary">—</div>
                  <div className="text-[11px] text-text-tertiary">{t("integrations.realtime")}</div>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div>
            <h3 className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider mb-3">
              {t("integrations.actions")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {isConnected ? (
                <>
                  <ActionButton
                    icon={<RotateCcw size={14} />}
                    label={t("integrations.restart")}
                    loading={actionLoading === "restart"}
                    onClick={() => handleAction("restart")}
                  />
                  <ActionButton
                    icon={<Square size={14} />}
                    label={t("integrations.stop")}
                    loading={actionLoading === "stop"}
                    onClick={() => handleAction("stop")}
                  />
                  {hasRefresh && (
                    <ActionButton
                      icon={<RefreshCw size={14} />}
                      label={t("integrations.refresh")}
                      loading={actionLoading === "refresh"}
                      onClick={() => handleAction("refresh")}
                    />
                  )}
                </>
              ) : (
                <ActionButton
                  icon={<Play size={14} />}
                  label={hasRequiredEmpty ? t("integrations.fillRequired") : t("integrations.start")}
                  loading={actionLoading === "start"}
                  onClick={() => handleAction("start")}
                  primary
                  disabled={hasRequiredEmpty}
                />
              )}
            </div>
          </div>

          {/* Message */}
          {message && (
            <p
              className={`text-[13px] ${message.type === "success" ? "text-success" : "text-error"}`}
            >
              {message.text}
            </p>
          )}

          {/* Configuration */}
          <div>
            <h3 className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider mb-3">
              {t("integrations.configuration")}
            </h3>
            <div className="space-y-3">
              {integration.settings.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={values[setting.key] ?? ""}
                  onChange={(val) => handleFieldChange(setting.key, val)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="w-full px-4 py-2.5 text-[14px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                {t("common.saving")}
              </span>
            ) : (
              t("common.save")
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function ActionButton({
  icon,
  label,
  loading,
  onClick,
  primary,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-[6px] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default ${
        primary
          ? "bg-primary text-white hover:bg-primary-hover"
          : "text-text-secondary border border-border hover:bg-border-light"
      }`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function SettingField({
  setting,
  value,
  onChange,
}: {
  setting: IntegrationSettingDef;
  value: string;
  onChange: (val: string) => void;
}) {
  if (setting.type === "boolean") {
    const checked = value === "true";
    return (
      <div className="flex items-center gap-3 py-1">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(checked ? "false" : "true")}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            checked ? "bg-primary" : "bg-border"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
              checked ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-[13px] text-text">{setting.label}</span>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
        {setting.label}
        {setting.required ? <span className="text-error ml-0.5">*</span> : <span className="text-text-tertiary ml-1">(opt.)</span>}
      </label>
      <input
        type={setting.type === "password" ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={setting.placeholder ?? ""}
        className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
      />
    </div>
  );
}
