import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plug, Wifi, WifiOff, Play, Square, AlertTriangle, RefreshCw } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { getIntegrations, updateSettings, startIntegration, stopIntegration, refreshIntegration } from "../api";
import type { IntegrationInfo, IntegrationSettingDef } from "../types";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getIntegrations();
      setIntegrations(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <Plug size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("integrations.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">{t("integrations.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} onRefresh={load} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ integration, onRefresh }: { integration: IntegrationInfo; onRefresh: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(integration.settingValues);

  const isConnected = integration.status === "connected";
  const isError = integration.status === "error";

  // Get Lucide icon dynamically
  const IconComponent = (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[integration.icon] ?? Plug;

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      // Build settings entries with integration prefix
      // Skip password fields that haven't been changed (still showing mask)
      const PASSWORD_MASK = "••••••••";
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        const setting = integration.settings.find((s) => s.key === key);
        if (setting?.type === "password" && value === PASSWORD_MASK) continue;
        entries[`integration.${integration.id}.${key}`] = value;
      }
      await updateSettings(entries);
      setDirty(false);
      setSuccess(t("integrations.saved"));
      setTimeout(() => setSuccess(""), 3000);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleStartStop = async () => {
    setError("");
    setSuccess("");
    setStarting(true);
    try {
      if (isConnected) {
        await stopIntegration(integration.id);
        setSuccess(t("integrations.stopped"));
      } else {
        await startIntegration(integration.id);
        setSuccess(t("integrations.started"));
      }
      setTimeout(() => setSuccess(""), 3000);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setStarting(false);
    }
  };

  const handleRefresh = async () => {
    setError("");
    setRefreshing(true);
    try {
      await refreshIntegration(integration.id);
      setSuccess(t("integrations.refreshed"));
      setTimeout(() => setSuccess(""), 3000);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-[6px] flex items-center justify-center">
            <IconComponent size={16} className="text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-text">{integration.name}</h2>
            <p className="text-[11px] text-text-tertiary">{integration.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <Wifi size={14} className="text-green-500" />
          ) : isError ? (
            <AlertTriangle size={14} className="text-red-500" />
          ) : (
            <WifiOff size={14} className="text-text-tertiary" />
          )}
          <span className={`text-[11px] font-medium ${
            isConnected
              ? "text-green-600 dark:text-green-400"
              : isError
                ? "text-red-600 dark:text-red-400"
                : "text-text-tertiary"
          }`}>
            {t(`status.${integration.status === "not_configured" ? "disconnected" : integration.status}`)}
          </span>
        </div>
      </div>

      {/* Dynamic settings form */}
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

      {/* Error / Success */}
      {error && <p className="mt-3 text-[13px] text-error">{error}</p>}
      {success && <p className="mt-3 text-[13px] text-green-600 dark:text-green-400">{success}</p>}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button
          onClick={handleStartStop}
          disabled={starting}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          {isConnected ? (
            <Square size={14} />
          ) : (
            <Play size={14} className={starting ? "animate-pulse" : ""} />
          )}
          {isConnected ? t("integrations.stop") : t("integrations.start")}
        </button>
        {isConnected && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {t("integrations.refresh")}
          </button>
        )}
      </div>
    </section>
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
        {!setting.required && (
          <span className="text-text-tertiary ml-1">(opt.)</span>
        )}
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
