import { useState, useEffect, useCallback, useRef } from "react";
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
  Timer,
  ExternalLink,
  CheckCircle,
  Power,
} from "lucide-react";
import { PluginIcon } from "../plugins/PluginIcon";
import {
  updateSettings,
  startIntegration,
  stopIntegration,
  restartIntegration,
  refreshIntegration,
  getPluginOAuthUrl,
  enablePlugin,
  disablePlugin,
} from "../../api";
import type { IntegrationInfo, IntegrationSettingDef } from "../../types";
import { FIELD_LABEL } from "../ui/text-roles";
import { Switch } from "../ui/Switch";

interface IntegrationDrawerProps {
  integration: IntegrationInfo | null;
  onClose: () => void;
  onRefresh: () => void;
}

/** Spec 216: second read of the list after a start, once the plugin knows why it failed. */
const STATUS_FOLLOW_UP_MS = 3000;

export function IntegrationDrawer({ integration, onClose, onRefresh }: IntegrationDrawerProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Spec 216: a plugin learns why it cannot connect a moment after start()
  // returns (the broker refuses, the name does not resolve), so the list is
  // read again shortly after a start to show that reason.
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (followUp.current) clearTimeout(followUp.current);
    },
    [],
  );
  const [oauthLoading, setOauthLoading] = useState(false);
  // Spec 212: an empty required field is marked once left or saved, never on open.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [triedSave, setTriedSave] = useState(false);

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

  // Spec 212 review: the list reloads after a save and hands a new object for
  // the same integration; the marks of that form must survive it.
  const integrationId = integration?.id;
  useEffect(() => {
    setTouched({});
    setTriedSave(false);
  }, [integrationId]);

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

  const handleOAuthConnect = async () => {
    setOauthLoading(true);
    try {
      // Spec 212 R7: the provider is reached with what the form shows, not
      // with the settings saved before the last edit.
      // A connected plugin's "Reconnect" keeps its old behaviour: unsaved
      // edits go through Save, which also restarts it (spec 212 review).
      if (dirty && !isConnected) {
        setTriedSave(true);
        await saveSettings();
        onRefresh();
      }
      const { url } = await getPluginOAuthUrl(integration.id);
      window.location.assign(url);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : t("common.error"));
      setOauthLoading(false);
    }
  };

  const refreshAfterStart = () => {
    onRefresh();
    if (followUp.current) clearTimeout(followUp.current);
    followUp.current = setTimeout(onRefresh, STATUS_FOLLOW_UP_MS);
  };

  const isDisabled = integration.enabled === false;
  // When the plugin is disabled, hide noisy "error" / "disconnected" runtime
  // states behind the persistent "disabled" label — the integration is
  // intentionally not running, anything else would be a UX lie.
  const isConnected = !isDisabled && integration.status === "connected";
  const isError = !isDisabled && integration.status === "error";
  const hasRefresh = !!integration.polling;
  const missing = integration.settings.filter((s) => s.required && !values[s.key]?.trim());
  const hasRequiredEmpty = missing.length > 0;
  const missingLabels = missing.map((s) => s.label).join(", ");
  const fieldId = (key: string) => `integration-${integration.id}-${key}`;
  const isMarked = (s: IntegrationSettingDef) =>
    missing.includes(s) && (touched[s.key] === true || triedSave);
  const focusField = (key: string) => document.getElementById(fieldId(key))?.focus();

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  /** Writes the form; shared by Save and by Save-and-connect (spec 212). */
  const saveSettings = async () => {
    const PASSWORD_MASK = "••••••••";
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      const setting = integration.settings.find((s) => s.key === key);
      if (setting?.type === "password" && value === PASSWORD_MASK) continue;
      entries[`integration.${integration.id}.${key}`] = value;
    }
    await updateSettings(entries);
    setDirty(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setTriedSave(true);
    try {
      await saveSettings();
      if (isConnected) {
        await restartIntegration(integration.id);
        showMessage("success", t("integrations.savedRestarted"));
        refreshAfterStart();
      } else {
        showMessage("success", t("integrations.saved"));
        onRefresh();
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (
    action: "start" | "stop" | "restart" | "refresh" | "enable" | "disable",
  ) => {
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
        case "enable":
          await enablePlugin(integration.id);
          showMessage("success", t("integrations.enabled"));
          break;
        case "disable":
          await disablePlugin(integration.id);
          showMessage("success", t("integrations.disabled"));
          break;
      }
      if (action === "start" || action === "restart" || action === "enable") refreshAfterStart();
      else onRefresh();
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
            <div className="w-9 h-9 bg-border-light rounded-md flex items-center justify-center">
              <PluginIcon name={integration.icon} size={18} className="text-text-secondary" />
            </div>
            <div>
              <h2 className="text-lead font-semibold text-text">{integration.name}</h2>
              <p className="text-caption text-text-tertiary">{integration.description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-sm hover:bg-border-light transition-colors cursor-pointer"
          >
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Status cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-background rounded-md p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {isDisabled ? (
                  <Power size={14} className="text-text-tertiary" />
                ) : isConnected ? (
                  <Wifi size={14} className="text-success" />
                ) : isError ? (
                  <AlertTriangle size={14} className="text-error" />
                ) : (
                  <WifiOff size={14} className="text-text-tertiary" />
                )}
              </div>
              <div
                className={`text-small font-medium ${isDisabled ? "text-text-tertiary" : isConnected ? "text-success" : isError ? "text-error" : "text-text-tertiary"}`}
              >
                {isDisabled
                  ? t("integrations.disabledStatus")
                  : t(
                      `status.${integration.status === "not_configured" ? "disconnected" : integration.status}`,
                    )}
              </div>
            </div>
            <div className="bg-background rounded-md p-3 text-center">
              <div className="text-title font-semibold text-text tabular-nums">
                {integration.deviceCount}
              </div>
              <div className="text-micro text-text-tertiary">
                {t("integrations.devices")}
                {integration.offlineDeviceCount > 0 && (
                  <span className="text-warning-ink ml-1">
                    ({integration.offlineDeviceCount} off)
                  </span>
                )}
              </div>
            </div>
            <div className="bg-background rounded-md p-3 text-center">
              {integration.polling ? (
                <>
                  <div className="flex items-center justify-center gap-1 text-small font-medium text-text tabular-nums">
                    <Timer size={12} className="text-text-tertiary" />
                    {Math.round(integration.polling.intervalMs / 1000)}s
                  </div>
                  <div className="text-micro text-text-tertiary">{t("integrations.polling")}</div>
                </>
              ) : (
                <>
                  <div className="text-small font-medium text-text-tertiary">—</div>
                  <div className="text-micro text-text-tertiary">{t("integrations.realtime")}</div>
                </>
              )}
            </div>
          </div>

          {/* Spec 216: the plugin's reason, while it is not connected */}
          {!isDisabled && !isConnected && integration.statusDetail && (
            <div
              role="status"
              className="flex items-start gap-2 bg-background rounded-md p-3 text-small text-text-secondary"
            >
              <AlertTriangle
                size={14}
                className={`mt-0.5 shrink-0 ${isError ? "text-error" : "text-warning-ink"}`}
              />
              <span className="break-words min-w-0">{integration.statusDetail}</span>
            </div>
          )}

          {/* Actions */}
          <div>
            <h3 className="text-lead font-semibold text-text mb-3">{t("integrations.actions")}</h3>
            <div className="flex flex-wrap gap-2">
              {isDisabled ? (
                <ActionButton
                  icon={<Power size={14} />}
                  label={t("integrations.enable")}
                  loading={actionLoading === "enable"}
                  onClick={() => handleAction("enable")}
                  primary
                />
              ) : isConnected ? (
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
                  <ActionButton
                    icon={<Power size={14} />}
                    label={t("integrations.disable")}
                    loading={actionLoading === "disable"}
                    onClick={() => handleAction("disable")}
                  />
                </>
              ) : (
                <>
                  <ActionButton
                    icon={<Play size={14} />}
                    label={t("integrations.start")}
                    loading={actionLoading === "start"}
                    onClick={() => handleAction("start")}
                    primary
                    disabled={hasRequiredEmpty}
                  />
                  <ActionButton
                    icon={<Power size={14} />}
                    label={t("integrations.disable")}
                    loading={actionLoading === "disable"}
                    onClick={() => handleAction("disable")}
                  />
                </>
              )}
            </div>
            {hasRequiredEmpty && !isDisabled && !isConnected && (
              <p className="text-caption text-error mt-2" role="status">
                {t("integrations.missingFields")}{" "}
                {missing.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      onClick={() => focusField(s.key)}
                      className="underline underline-offset-2 cursor-pointer"
                    >
                      {s.label}
                    </button>
                    {i === missing.length - 1 && "."}
                  </span>
                ))}
              </p>
            )}
          </div>

          {/* Message */}
          {message && (
            <p
              className={`text-small ${message.type === "success" ? "text-success" : "text-error"}`}
            >
              {message.text}
            </p>
          )}

          {/* Configuration */}
          <div>
            <h3 className="text-lead font-semibold text-text mb-3">
              {t("integrations.configuration")}
            </h3>
            <div className="space-y-3">
              {integration.settings.map((setting) => (
                <SettingField
                  key={setting.key}
                  id={fieldId(setting.key)}
                  setting={setting}
                  value={values[setting.key] ?? ""}
                  onChange={(val) => handleFieldChange(setting.key, val)}
                  onBlur={() => setTouched((prev) => ({ ...prev, [setting.key]: true }))}
                  invalidMessage={isMarked(setting) ? t("integrations.requiredField") : undefined}
                />
              ))}
            </div>
          </div>

          {/* OAuth Authorization */}
          {integration.supportsOAuth && (
            <div>
              <h3 className="text-lead font-semibold text-text mb-3">
                {t("integrations.authorization")}
              </h3>
              {isConnected ? (
                <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md px-4 py-3">
                  <div className="flex items-center gap-2 text-success text-small font-medium">
                    <CheckCircle size={15} />
                    {t("integrations.oauthConnected")}
                  </div>
                  <button
                    onClick={handleOAuthConnect}
                    disabled={oauthLoading}
                    className="text-caption text-text-tertiary hover:text-text underline cursor-pointer disabled:opacity-50"
                  >
                    {t("integrations.oauthReconnect")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleOAuthConnect}
                  disabled={oauthLoading || hasRequiredEmpty}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-body font-medium bg-primary-fill text-white rounded-sm hover:bg-primary-fill-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  {oauthLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ExternalLink size={15} />
                  )}
                  {dirty && !hasRequiredEmpty
                    ? t("integrations.oauthSaveAndConnect", { name: integration.name })
                    : t("integrations.oauthConnect", { name: integration.name })}
                </button>
              )}
              {hasRequiredEmpty && !isConnected && (
                <p className="text-caption text-text-tertiary mt-2">
                  {t("integrations.oauthFillFirst", { fields: missingLabels })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="w-full px-4 py-2.5 text-body font-medium bg-primary-fill text-white rounded-sm hover:bg-primary-fill-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
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
      className={`flex items-center gap-1.5 px-3 py-2 text-small font-medium rounded-sm transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default ${
        primary
          ? "bg-primary-fill text-white hover:bg-primary-fill-hover"
          : "text-text-secondary border border-border hover:bg-border-light"
      }`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function SettingField({
  id,
  setting,
  value,
  onChange,
  onBlur,
  invalidMessage,
}: {
  id: string;
  setting: IntegrationSettingDef;
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  /** Spec 212: set when a required field is empty and was left or saved. */
  invalidMessage?: string;
}) {
  if (setting.type === "boolean") {
    const checked = value === "true";
    return (
      <div className="flex items-center gap-3 py-1">
        <Switch
          checked={checked}
          onChange={(next) => onChange(next ? "true" : "false")}
          label={setting.label}
        />
        <span className="text-small text-text">{setting.label}</span>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {setting.label}
        {setting.required ? (
          <span className="text-error ml-0.5">*</span>
        ) : (
          <span className="text-text-tertiary ml-1">(opt.)</span>
        )}
      </label>
      <input
        id={id}
        type={setting.type === "password" ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={setting.placeholder ?? ""}
        aria-invalid={invalidMessage ? true : undefined}
        aria-describedby={invalidMessage ? `${id}-error` : undefined}
        className={`w-full px-3 py-2 text-body bg-background border rounded-sm text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary ${invalidMessage ? "border-error" : "border-border"}`}
      />
      {invalidMessage && (
        <p id={`${id}-error`} className="text-caption text-error mt-1">
          {invalidMessage}
        </p>
      )}
    </div>
  );
}
