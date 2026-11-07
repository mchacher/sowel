import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Minus, Plus } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { splitEvChargerExtras, type EvVehicleState } from "../../lib/ev-charger-contract";
import { extraLabel, extraTextValue } from "../../lib/extra-labels";
import { formatValue } from "./useEquipmentState";
import { LightControl } from "./LightControl";
import {
  clampChargeCurrent,
  evChargerStateOf,
  evVehicleKey,
  evVehiclePillClass,
} from "./evChargerState";
import { formatEnergy, formatNumber, formatPower, formatRange, formatWithUnit } from "../../lib/format";

interface EvChargerControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function EvVehicleBadge({ vehicle }: { vehicle: EvVehicleState | null }) {
  const { t } = useTranslation();
  if (!vehicle) return null;
  return (
    <span
      className={`text-caption font-medium px-2.5 py-0.5 rounded-full ${evVehiclePillClass(vehicle)}`}
    >
      {t(evVehicleKey(vehicle))}
    </span>
  );
}


/**
 * Spec 182 — the EV charger control surface, shared by the detail page and the
 * mobile sheet: start/stop, the vehicle, live power and session energy, and a
 * charging-current stepper bounded by the order's own range. Every element
 * renders only when its contract point is bound.
 */
export function EvChargerControl({ equipment, onExecuteOrder }: EvChargerControlProps) {
  const { t } = useTranslation();
  const s = evChargerStateOf(equipment);
  const [sending, setSending] = useState(false);
  // Optimistic target while the charger confirms its setpoint reading (a
  // write takes ~1 s). Without a setpoint reading bound there is nothing to
  // confirm against, so the last value the charger accepted is kept instead.
  const [pendingA, setPendingA] = useState<number | null>(null);
  const [lastSentA, setLastSentA] = useState<number | null>(null);
  const hasReading = s.chargeCurrentA !== null;

  useEffect(() => {
    if (pendingA === null || !hasReading) return;
    if (s.chargeCurrentA === pendingA) {
      setPendingA(null);
      return;
    }
    const id = setTimeout(() => setPendingA(null), 10_000); // safety net
    return () => clearTimeout(id);
  }, [pendingA, s.chargeCurrentA, hasReading]);

  const usable = equipment.enabled && equipment.status !== "offline";
  const order = s.chargeCurrentOrder;
  const shownA = pendingA ?? (hasReading ? s.chargeCurrentA : lastSentA);

  const step = async (delta: number) => {
    if (!order || sending || !usable) return;
    // From an unknown setpoint the first press selects the minimum, so every
    // value of the range is reachable.
    const target = shownA === null ? order.min : clampChargeCurrent(shownA + delta, order);
    if (target === shownA) return;
    setSending(true);
    setPendingA(target);
    try {
      await onExecuteOrder(order.alias, target);
      if (!hasReading) {
        setLastSentA(target);
        setPendingA(null);
      }
    } catch {
      setPendingA(null);
    } finally {
      setSending(false);
    }
  };

  // Everything bound beyond the contract (status, temperature, last session…).
  const { extraData } = splitEvChargerExtras(equipment.dataBindings, equipment.orderBindings);

  const metrics: { key: string; label: string; value: string }[] = [];
  if (s.power.watts !== null) {
    metrics.push({
      key: "power",
      label: t("equipments.evCharger.power"),
      value: formatPower(s.power.watts),
    });
  }
  if (s.sessionEnergyKwh !== null) {
    metrics.push({
      key: "session",
      label: t("equipments.evCharger.session"),
      value: formatEnergy(s.sessionEnergyKwh),
    });
  }
  if (s.measuredCurrentA !== null) {
    metrics.push({
      key: "current",
      label: t("equipments.evCharger.measuredCurrent"),
      value: formatWithUnit(s.measuredCurrentA, "A"),
    });
  }
  if (s.voltageV !== null) {
    metrics.push({
      key: "voltage",
      label: t("equipments.evCharger.voltage"),
      value: formatWithUnit(s.voltageV, "V"),
    });
  }

  return (
    <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3">
        <EvVehicleBadge vehicle={s.vehicle} />
        {s.canToggle && usable && (
          <div className="flex items-center gap-2">
            <span className="text-small text-text-secondary">
              {t("equipments.evCharger.charge")}
            </span>
            <LightControl equipment={equipment} onExecuteOrder={onExecuteOrder} />
          </div>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div key={m.key} className="flex flex-col">
              <span className="text-caption text-text-tertiary">{m.label}</span>
              <span className="text-lead font-semibold text-text tabular-nums">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {(order || s.chargeCurrentA !== null) && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-small text-text-secondary">
            {t("equipments.evCharger.chargeCurrent")}
          </span>
          <div className="hit-group flex items-center gap-2">
            {order && (
              <button
                type="button"
                aria-label={t("equipments.evCharger.decrease")}
                onClick={() => void step(-1)}
                disabled={!usable || sending || (shownA !== null && shownA <= order.min)}
                className="hit-44 p-1.5 rounded-sm bg-border-light text-text-secondary hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Minus size={14} strokeWidth={1.5} />
              </button>
            )}
            <span className="min-w-[56px] text-center text-lead font-semibold text-text tabular-nums">
              {sending ? (
                <Loader2 size={14} className="animate-spin inline" />
              ) : shownA !== null ? (
                formatWithUnit(shownA, "A")
              ) : (
                "—"
              )}
            </span>
            {order && (
              <button
                type="button"
                aria-label={t("equipments.evCharger.increase")}
                onClick={() => void step(1)}
                disabled={!usable || sending || (shownA !== null && shownA >= order.max)}
                className="hit-44 p-1.5 rounded-sm bg-border-light text-text-secondary hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      )}
      {order && (
        <span className="text-micro text-text-tertiary -mt-3 text-right">
          {formatRange(formatNumber(order.min, { maxDecimals: 1 }), formatWithUnit(order.max, "A"))}
        </span>
      )}

      {extraData.length > 0 && (
        <div className="flex flex-col gap-1 pt-3 border-t border-border-light">
          {extraData.map((b) => (
            <div key={b.alias} className="flex items-center justify-between gap-3 text-small">
              <span className="text-text-secondary">{extraLabel("equipments.evCharger", b.alias, t)}</span>
              <span className="tabular-nums text-text">{typeof b.value === "string"
                  ? extraTextValue("equipments.evCharger", b.alias, b.value, t)
                  : formatValue(b.value, b.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
