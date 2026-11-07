import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { splitEvChargerExtras, type EvVehicleState } from "../../lib/ev-charger-contract";
import { extraLabel, extraTextValue } from "../../lib/extra-labels";
import { formatValue } from "./useEquipmentState";
import { LightControl } from "./LightControl";
import { evChargerStateOf, evVehicleKey, evVehiclePillClass } from "./evChargerState";
import {
  formatEnergy,
  formatNumber,
  formatPower,
  formatRange,
  formatWithUnit,
} from "../../lib/format";
import { SetpointStepper } from "./SetpointStepper";
import { useSetpointCommitDelay } from "../../hooks/useSetpointCommit";

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
  // Spec 196, slice 8a: the current goes through the setpoint stepper, one
  // order after the last tap, the requested value held until the charger
  // reports it. Without a setpoint reading bound there is nothing to confirm
  // against, so the last value the charger accepted is shown instead.
  const [lastSentA, setLastSentA] = useState<number | null>(null);
  const hasReading = s.chargeCurrentA !== null;
  const commitDelay = useSetpointCommitDelay(equipment);

  const usable = equipment.enabled && equipment.status !== "offline";
  const order = s.chargeCurrentOrder;
  const deviceA = hasReading ? s.chargeCurrentA : lastSentA;

  // Everything bound beyond the contract (status, temperature, last session…).
  const { extraData } = splitEvChargerExtras(equipment.dataBindings, equipment.orderBindings);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
              <span className="text-lead font-semibold text-text tabular-nums">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {(order || s.chargeCurrentA !== null) && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-small text-text-secondary">
            {t("equipments.evCharger.chargeCurrent")}
          </span>
          {order ? (
            <SetpointStepper
              size="md"
              value={deviceA}
              min={order.min}
              max={order.max}
              step={1}
              unit="A"
              // From an unknown setpoint the first press selects the minimum,
              // so every value of the range is reachable.
              startValue={order.min}
              disabled={!usable}
              label={t("equipments.evCharger.chargeCurrent")}
              decreaseLabel={t("equipments.evCharger.decrease")}
              increaseLabel={t("equipments.evCharger.increase")}
              debounceMs={commitDelay}
              onCommit={async (v) => {
                await onExecuteOrder(order.alias, v);
                if (!hasReading) setLastSentA(v);
              }}
            />
          ) : (
            <span className="min-w-[56px] text-center text-lead font-semibold text-text tabular-nums">
              {formatWithUnit(s.chargeCurrentA, "A")}
            </span>
          )}
        </div>
      )}
      {order && (
        <span className="text-micro text-text-tertiary -mt-3 text-right">
          {formatRange(formatNumber(order.min, { maxDecimals: 1 }), formatWithUnit(order.max, "A"))}
        </span>
      )}

      {extraData.length > 0 && (
        <div className="flex flex-col gap-1 pt-3 border-t border-border-light">
          {/* Spec 196 — the plugin's raw list folds away, closed: usage first. */}
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="self-start flex items-center gap-1 text-caption text-text-tertiary hover:text-text-secondary cursor-pointer"
          >
            {detailsOpen ? (
              <ChevronDown size={12} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} />
            )}
            {t("equipments.evCharger.details", { n: extraData.length })}
          </button>
          {detailsOpen &&
            extraData.map((b) => (
              <div key={b.alias} className="flex items-center justify-between gap-3 text-small">
                <span className="text-text-secondary">
                  {extraLabel("equipments.evCharger", b.alias, t)}
                </span>
                <span className="tabular-nums text-text">
                  {typeof b.value === "string"
                    ? extraTextValue("equipments.evCharger", b.alias, b.value, t)
                    : formatValue(b.value, b.unit)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
