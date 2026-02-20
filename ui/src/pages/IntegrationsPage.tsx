import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plug, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { getSettings, updateSettings, reconnectMqtt, getMqttStatus } from "../api";

export function IntegrationsPage() {
  const { t } = useTranslation();

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
        <Zigbee2mqttCard />
      </div>
    </div>
  );
}

function Zigbee2mqttCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dirty, setDirty] = useState(false);

  // Editable fields
  const [mqttUrl, setMqttUrl] = useState("");
  const [mqttUsername, setMqttUsername] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [mqttClientId, setMqttClientId] = useState("");
  const [z2mBaseTopic, setZ2mBaseTopic] = useState("");

  const load = async () => {
    try {
      const [data, status] = await Promise.all([getSettings(), getMqttStatus()]);
      setSettings(data);
      setConnected(status.connected);
      setMqttUrl(data["mqtt.url"] ?? "");
      setMqttUsername(data["mqtt.username"] ?? "");
      setMqttPassword(data["mqtt.password"] ?? "");
      setMqttClientId(data["mqtt.clientId"] ?? "");
      setZ2mBaseTopic(data["z2m.baseTopic"] ?? "");
      setDirty(false);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Check if any field has changed
  const checkDirty = (field: string, value: string) => {
    const next = { ...settings, [field]: value };
    const changed = Object.keys(next).some((k) => next[k] !== settings[k]);
    setDirty(changed);
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await updateSettings({
        "mqtt.url": mqttUrl,
        "mqtt.username": mqttUsername,
        "mqtt.password": mqttPassword,
        "mqtt.clientId": mqttClientId,
        "z2m.baseTopic": z2mBaseTopic,
      });
      // Reload settings from server
      const data = await getSettings();
      setSettings(data);
      setDirty(false);
      setSuccess(t("integrations.saved"));
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = async () => {
    setError("");
    setSuccess("");
    setReconnecting(true);
    try {
      const result = await reconnectMqtt();
      setConnected(result.connected);
      setSuccess(
        result.connected
          ? t("integrations.reconnectSuccess")
          : t("integrations.reconnectFailed"),
      );
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setReconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-[10px] border border-border p-5 flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-[6px] flex items-center justify-center">
            <Plug size={16} className="text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-text">Zigbee2MQTT</h2>
            <p className="text-[11px] text-text-tertiary">{t("integrations.z2mDescription")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi size={14} className="text-green-500" />
          ) : (
            <WifiOff size={14} className="text-red-500" />
          )}
          <span className={`text-[11px] font-medium ${connected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {connected ? t("status.connected") : t("status.disconnected")}
          </span>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
            {t("integrations.mqttUrl")}
          </label>
          <input
            type="text"
            value={mqttUrl}
            onChange={(e) => { setMqttUrl(e.target.value); checkDirty("mqtt.url", e.target.value); }}
            placeholder="mqtt://localhost:1883"
            className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("integrations.mqttUsername")}
              <span className="text-text-tertiary ml-1">({t("common.optional")})</span>
            </label>
            <input
              type="text"
              value={mqttUsername}
              onChange={(e) => { setMqttUsername(e.target.value); checkDirty("mqtt.username", e.target.value); }}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("integrations.mqttPassword")}
              <span className="text-text-tertiary ml-1">({t("common.optional")})</span>
            </label>
            <input
              type="password"
              value={mqttPassword}
              onChange={(e) => { setMqttPassword(e.target.value); checkDirty("mqtt.password", e.target.value); }}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("integrations.mqttClientId")}
            </label>
            <input
              type="text"
              value={mqttClientId}
              onChange={(e) => { setMqttClientId(e.target.value); checkDirty("mqtt.clientId", e.target.value); }}
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("integrations.z2mBaseTopic")}
            </label>
            <input
              type="text"
              value={z2mBaseTopic}
              onChange={(e) => { setZ2mBaseTopic(e.target.value); checkDirty("z2m.baseTopic", e.target.value); }}
              placeholder="zigbee2mqtt"
              className="w-full px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
        </div>
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
          onClick={handleReconnect}
          disabled={reconnecting}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          <RefreshCw size={14} className={reconnecting ? "animate-spin" : ""} />
          {t("integrations.reconnect")}
        </button>
      </div>
    </section>
  );
}
