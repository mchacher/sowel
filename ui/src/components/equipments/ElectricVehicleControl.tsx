import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BatteryCharging, Loader2, Minus, Plug, Plus, Zap } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { splitElectricVehicleExtras } from "../../lib/electric-vehicle-contract";
import { formatRelative } from "../../lib/format-relative";
import { humanizeAlias } from "../../lib/humanize-alias";
import { formatValue } from "./useEquipmentState";
import { electricVehicleStateOf, evBatteryTone, evChargingStateKey } from "./electricVehicleState";

interface ElectricVehicleControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

/** Battery bar with the car's charge limit marked on it. */
export function EvBatteryBar({ level, limit }: { level: number; limit: number | null }) {
  const pct = Math.max(0, Math.min(100, level));
  return (
    <div className="relative h-2 w-full rounded-full bg-border-light overflow-hidden">
      <div className={`h-full ${evBatteryTone(pct)}`} style={{ width: `${pct}%` }} />
      {limit !== null && (
        <div className="absolute top-0 h-full w-0.5 bg-text-secondary" style={{ left: `${limit}%` }} />
      )}
    </div>
  );
}

/**
 * Spec 183 — the electric vehicle surface, shared by the detail page and the
 * mobile sheet: battery with the car's limit, range, charging state, the age of
 * the car's last report, Wake / Start charging, the charge-limit stepper, and
 * the maker's extras. Every element renders only when its contract point is.
 */
export function ElectricVehicleControl({ equipment, onExecuteOrder }: ElectricVehicleControlProps) {
  const { t } = useTranslation();
  const s = electricVehicleStateOf(equipment);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);
  const usable = equipment.enabled && equipment.status !== "offline";

  const send = async (key: string, alias: string, value: unknown, okText: string) => {
    if (busy || !usable) return;
    setBusy(key);
    setOutcome(null);
    try {
      await onExecuteOrder(alias, value);
      setOutcome({ ok: true, text: okText });
    } catch (err) {
      setOutcome({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const order = s.chargeLimitOrder;
  const shownLimit = pendingLimit ?? s.chargeLimit;
  const stepLimit = async (delta: number) => {
    if (!order) return;
    const base = shownLimit ?? order.max;
    const target = Math.min(order.max, Math.max(order.min, Math.round((base + delta) / 5) * 5));
    if (target === shownLimit) return;
    setPendingLimit(target);
    await send("limit", order.alias, target, t("equipments.electricVehicle.limitSent", { value: target }));
    setPendingLimit(null);
  };

  const { extraData } = splitElectricVehicleExtras(equipment.dataBindings, equipment.orderBindings);

  return (
    <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
      {s.batteryLevel !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[28px] font-semibold text-text tabular-nums">
              {Math.round(s.batteryLevel)}
              <span className="text-[14px] text-text-tertiary font-normal ml-0.5">%</span>
            </span>
            <span className="text-[13px] text-text-secondary">
              {s.rangeKm !== null && `${Math.round(s.rangeKm)} km`}
              {s.chargeLimit !== null &&
                ` · ${t("equipments.electricVehicle.limit", { value: Math.round(s.chargeLimit) })}`}
            </span>
          </div>
          <EvBatteryBar level={s.batteryLevel} limit={s.chargeLimit} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {s.chargingState && (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {s.chargingState === "charging" ? (
              <Zap size={12} strokeWidth={1.5} />
            ) : (
              <Plug size={12} strokeWidth={1.5} />
            )}
            {t(evChargingStateKey(s.chargingState))}
          </span>
        )}
        {s.atHome !== null && (
          <span className="px-2.5 py-0.5 rounded-full bg-border-light text-text-secondary">
            {s.atHome ? t("equipments.electricVehicle.atHome") : t("equipments.electricVehicle.away")}
          </span>
        )}
        {s.reportStale && s.reportedAt && (
          <span className="text-text-tertiary">
            {t("equipments.electricVehicle.reported", { age: formatRelative(s.reportedAt, t) })}
          </span>
        )}
      </div>

      {(s.wakeAlias || s.chargeStartAlias) && (
        <div className="flex flex-wrap gap-2">
          {s.wakeAlias && (
            <button
              type="button"
              disabled={!usable || !!busy}
              onClick={() => void send("wake", s.wakeAlias!, null, t("equipments.electricVehicle.wakeSent"))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[13px] font-medium bg-border-light text-text-secondary hover:bg-border disabled:opacity-50 cursor-pointer"
            >
              {busy === "wake" && <Loader2 size={13} className="animate-spin" />}
              {t("equipments.electricVehicle.wake")}
            </button>
          )}
          {s.chargeStartAlias && (
            <button
              type="button"
              disabled={!usable || !!busy}
              onClick={() =>
                void send("start", s.chargeStartAlias!, null, t("equipments.electricVehicle.startSent"))
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[13px] font-medium bg-primary text-white hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
            >
              {busy === "start" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <BatteryCharging size={13} strokeWidth={1.5} />
              )}
              {t("equipments.electricVehicle.startCharging")}
            </button>
          )}
        </div>
      )}

      {order && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-text-secondary">{t("equipments.electricVehicle.chargeLimit")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t("equipments.electricVehicle.limitDown")}
              disabled={!usable || !!busy || (shownLimit !== null && shownLimit <= order.min)}
              onClick={() => void stepLimit(-5)}
              className="p-1.5 rounded-[6px] bg-border-light text-text-secondary hover:bg-border disabled:opacity-40 cursor-pointer"
            >
              <Minus size={14} strokeWidth={1.5} />
            </button>
            <span className="min-w-[56px] text-center font-mono text-[16px] font-semibold text-text tabular-nums">
              {busy === "limit" ? <Loader2 size={14} className="animate-spin inline" /> : shownLimit !== null ? `${shownLimit} %` : "—"}
            </span>
            <button
              type="button"
              aria-label={t("equipments.electricVehicle.limitUp")}
              disabled={!usable || !!busy || (shownLimit !== null && shownLimit >= order.max)}
              onClick={() => void stepLimit(5)}
              className="p-1.5 rounded-[6px] bg-border-light text-text-secondary hover:bg-border disabled:opacity-40 cursor-pointer"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <span className={`text-[12px] ${outcome.ok ? "text-success" : "text-error"}`}>{outcome.text}</span>
      )}

      {(s.mileageKm !== null || extraData.length > 0) && (
        <div className="flex flex-col gap-1 pt-3 border-t border-border-light">
          {s.mileageKm !== null && (
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-text-secondary">{t("equipments.electricVehicle.mileage")}</span>
              <span className="font-mono tabular-nums text-text">{Math.round(s.mileageKm).toLocaleString()} km</span>
            </div>
          )}
          {extraData.map((b) => (
            <div key={b.alias} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-text-secondary">{humanizeAlias(b.alias)}</span>
              <span className="font-mono tabular-nums text-text">{formatValue(b.value, b.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
