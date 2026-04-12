import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Power, Loader2, Droplets, Battery, AlertTriangle, Play } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface WaterValveControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

/** Returns true if the device status is a known abnormal state. */
function isAbnormalStatus(status: string): boolean {
  const s = status.toLowerCase();
  if (s.includes("normal")) return false;
  return (
    s.includes("shortage") ||
    s.includes("leak") ||
    s.includes("error") ||
    s.includes("fault")
  );
}

export function WaterValveControl({ equipment, onExecuteOrder, compact }: WaterValveControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const [watering, setWatering] = useState(false);
  const [duration, setDuration] = useState(10);

  const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
  const flowBinding = equipment.dataBindings.find((b) => b.alias === "flow");
  const batteryBinding = equipment.dataBindings.find((b) => b.alias === "battery");
  const statusBinding = equipment.dataBindings.find((b) => b.alias === "status");

  const isOn = stateBinding?.value === true || stateBinding?.value === "ON";

  const flow =
    flowBinding && typeof flowBinding.value === "number" ? flowBinding.value : null;
  const battery =
    batteryBinding && typeof batteryBinding.value === "number"
      ? batteryBinding.value
      : null;
  const statusRaw =
    statusBinding && typeof statusBinding.value === "string" ? statusBinding.value : null;
  const statusAbnormal = statusRaw !== null && isAbnormalStatus(statusRaw);
  const statusLabel = statusRaw
    ? t(`water.status.${statusRaw}`, { defaultValue: statusRaw.replace(/_/g, " ") })
    : null;

  const stateOrderBinding = equipment.orderBindings.find((b) => b.alias === "state");
  const hasStateOrder = !!stateOrderBinding;
  // Timed watering uses z2m's universal "on with timed off" pattern
  // ({"state":"ON","on_time":600}) — published atomically through the
  // composite payload support added in plugin v1.2.0. No separate `duration`
  // alias binding is required: any z2m switch with on_time firmware support
  // (incl. SONOFF SWV) accepts it.
  const hasTimedWatering = hasStateOrder;

  /**
   * Compute the right ON/OFF payload for the state order.
   *
   * The SONOFF SWV state is exposed by z2m as `binary` (mapped to our `boolean`
   * DataType), but z2m actually expects string payloads "ON" / "OFF" / "TOGGLE"
   * — sending raw `true`/`false` is rejected. We always send the string form
   * for the state alias, mirroring LightControl which has the same convention.
   */
  const stateValue = (turnOn: boolean): unknown => {
    if (!stateOrderBinding) return turnOn ? "ON" : "OFF";
    const onVal =
      stateOrderBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
    const offVal =
      stateOrderBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
    return turnOn ? onVal : offVal;
  };

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !hasStateOrder) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", stateValue(!isOn));
    } finally {
      setExecuting(false);
    }
  };

  const handleWaterNow = async () => {
    if (watering || !hasTimedWatering) return;
    setWatering(true);
    try {
      // Composite payload: state + on_time published in a single MQTT
      // message. The z2m plugin (v1.2.0+) detects an object value and
      // publishes it directly instead of wrapping under `payloadKey`.
      await onExecuteOrder("state", {
        state: stateValue(true),
        on_time: duration * 60,
      });
    } finally {
      setWatering(false);
    }
  };

  // ============================================================
  // Compact mode — used in equipment list
  // ============================================================
  if (compact) {
    if (!hasStateOrder) return null;
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {flow !== null && isOn && (
          <div className="flex items-baseline gap-0.5 text-text-secondary">
            <span className="text-[13px] font-medium tabular-nums font-mono">{flow}</span>
            <span className="text-[10px] text-text-tertiary">m³/h</span>
          </div>
        )}
        <button
          onClick={handleToggle}
          disabled={executing || !equipment.enabled}
          className={`
            p-2 rounded-[6px] transition-colors duration-150 cursor-pointer
            ${isOn
              ? "bg-active text-white hover:bg-active/80"
              : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"}
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={isOn ? t("water.closed") : t("water.open")}
        >
          {executing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} strokeWidth={1.5} />}
        </button>
      </div>
    );
  }

  // ============================================================
  // Full mode — used in equipment detail page
  // ============================================================
  return (
    <div className="space-y-3">
      {/* Toggle row — compact horizontal pill (matches LightControl) */}
      {hasStateOrder && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
              transition-colors duration-150
              ${isOn
                ? "bg-active text-white hover:bg-active/80"
                : "bg-border-light text-text-secondary hover:bg-border hover:text-text"}
              disabled:opacity-50
            `}
          >
            {executing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Power size={16} strokeWidth={1.5} />
            )}
            {isOn ? t("water.open") : t("water.closed")}
          </button>

          {/* Live flow inline when open */}
          {flow !== null && isOn && (
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Droplets size={14} strokeWidth={1.5} />
              <span className="text-[14px] font-semibold tabular-nums font-mono">{flow}</span>
              <span className="text-[12px] text-text-tertiary">m³/h</span>
            </div>
          )}
        </div>
      )}

      {/* Inline indicators row — battery + status, only colored when alert */}
      {(battery !== null || statusLabel !== null) && (
        <div className="flex items-center gap-2 flex-wrap">
          {battery !== null && (
            <Indicator
              icon={<Battery size={13} strokeWidth={1.5} />}
              label={t("water.battery")}
              value={`${battery}%`}
              alert={battery < 20}
            />
          )}
          {statusLabel !== null && (
            <Indicator
              icon={<AlertTriangle size={13} strokeWidth={1.5} />}
              label={t("water.status")}
              value={statusLabel}
              alert={statusAbnormal}
            />
          )}
        </div>
      )}

      {/* Timed watering — single row, all grouped on the left */}
      {hasTimedWatering && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[12px] text-text-tertiary">{t("water.duration")}</span>
          <input
            type="number"
            min={1}
            max={120}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
            className="w-14 px-2 py-1 text-[13px] tabular-nums border border-border rounded-[6px] outline-none focus:border-primary"
          />
          <span className="text-[12px] text-text-tertiary mr-1">{t("water.minutes")}</span>
          <button
            onClick={handleWaterNow}
            disabled={watering || !equipment.enabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[6px] bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {watering ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} strokeWidth={2} />
            )}
            {t("water.waterNow", { minutes: duration })}
          </button>
        </div>
      )}
    </div>
  );
}

// Small inline indicator pill — only shows accent color when in alert state
function Indicator({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border text-[12px]
        ${alert ? "border-error/30 bg-error/5 text-error" : "border-border bg-surface text-text-secondary"}
      `}
      title={label}
    >
      {icon}
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
