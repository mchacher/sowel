import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BatteryCharging, Loader2, Plug, RefreshCw, Zap } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { splitElectricVehicleExtras } from "../../lib/electric-vehicle-contract";
import { formatRelative } from "../../lib/format-relative";
import { useStalenessClock } from "../../hooks/useStalenessClock";
import { extraLabel, extraTextValue } from "../../lib/extra-labels";
import { formatValue } from "./useEquipmentState";
import { electricVehicleStateOf, evBatteryTone, evChargingStateKey } from "./electricVehicleState";
import { formatWithUnit } from "../../lib/format";
import { SetpointStepper } from "./SetpointStepper";
import { useSetpointCommitDelay } from "../../hooks/useSetpointCommit";

/** A car reports minutes after an order: the sent limit is held this long at most. */
const CHARGE_LIMIT_SETTLE_MS = 15 * 60_000;

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
        <div
          className="absolute top-0 h-full w-0.5 bg-text-secondary"
          style={{ left: `${Math.max(0, Math.min(100, limit))}%` }}
        />
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
  // Re-render on a clock: a sleeping car sends no event, and its age must grow.
  const now = useStalenessClock();
  const s = electricVehicleStateOf(equipment, now);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const commitDelay = useSetpointCommitDelay(equipment);
  const usable = equipment.enabled && equipment.status !== "offline";

  const send = async (
    key: string,
    alias: string,
    value: unknown,
    okText: string,
  ): Promise<boolean> => {
    if (busy || !usable) return false;
    setBusy(key);
    setOutcome(null);
    try {
      await onExecuteOrder(alias, value);
      setOutcome({ ok: true, text: okText });
      return true;
    } catch (err) {
      setOutcome({ ok: false, text: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const order = s.chargeLimitOrder;
  // Spec 196, slice 8a: the limit goes through the setpoint stepper, which
  // holds the sent value until the car's report confirms it (a car reports
  // minutes after an order, and the old value must not flash back meanwhile).
  const commitLimit = async (target: number) => {
    if (!order) return;
    const ok = await send(
      "limit",
      order.alias,
      target,
      t("equipments.electricVehicle.limitSent", { value: target }),
    );
    if (!ok) throw new Error("charge limit not applied");
  };

  const { extraData } = splitElectricVehicleExtras(equipment.dataBindings, equipment.orderBindings);

  return (
    <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
      {s.batteryLevel !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-display font-semibold text-text tabular-nums">
              {Math.round(s.batteryLevel)}
              <span className="text-body text-text-tertiary font-normal ml-0.5">%</span>
            </span>
            <span className="text-small text-text-secondary">
              {s.rangeKm !== null && formatWithUnit(s.rangeKm, "km")}
              {s.chargeLimit !== null &&
                ` · ${t("equipments.electricVehicle.limit", { value: Math.round(s.chargeLimit) })}`}
            </span>
          </div>
          <EvBatteryBar level={s.batteryLevel} limit={s.chargeLimit} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-small">
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
            {s.atHome
              ? t("equipments.electricVehicle.atHome")
              : t("equipments.electricVehicle.away")}
          </span>
        )}
        {s.reportStale && s.reportedAt && (
          <span className="text-text-tertiary">
            {t("equipments.electricVehicle.reported", { age: formatRelative(s.reportedAt, t) })}
          </span>
        )}
        {s.refreshAlias && (
          <button
            type="button"
            aria-label={t("equipments.electricVehicle.refresh")}
            title={t("equipments.electricVehicle.refresh")}
            disabled={!usable || !!busy}
            onClick={() =>
              void send(
                "refresh",
                s.refreshAlias!,
                null,
                t("equipments.electricVehicle.refreshSent"),
              )
            }
            className="p-1 rounded-sm text-text-tertiary hover:text-text-secondary hover:bg-border-light disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw
              size={13}
              strokeWidth={1.5}
              className={busy === "refresh" ? "animate-spin" : ""}
            />
          </button>
        )}
      </div>

      {(s.wakeAlias || s.chargeStartAlias) && (
        <div className="flex flex-wrap gap-2">
          {s.wakeAlias && (
            <button
              type="button"
              disabled={!usable || !!busy}
              onClick={() =>
                void send("wake", s.wakeAlias!, null, t("equipments.electricVehicle.wakeSent"))
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium bg-border-light text-text-secondary hover:bg-border disabled:opacity-50 cursor-pointer"
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
                void send(
                  "start",
                  s.chargeStartAlias!,
                  null,
                  t("equipments.electricVehicle.startSent"),
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-small font-medium bg-primary-fill text-white hover:bg-primary-fill-hover disabled:opacity-50 cursor-pointer"
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
          <span className="text-small text-text-secondary">
            {t("equipments.electricVehicle.chargeLimit")}
          </span>
          <SetpointStepper
            size="md"
            value={s.chargeLimit}
            min={order.min}
            max={order.max}
            step={5}
            unit="%"
            // From an unknown limit the first press proposes 80 %, the common
            // choice, rather than silently sending an end of the range.
            startValue={Math.min(order.max, Math.max(order.min, 80))}
            disabled={!usable || (busy !== null && busy !== "limit")}
            label={t("equipments.electricVehicle.chargeLimit")}
            decreaseLabel={t("equipments.electricVehicle.limitDown")}
            increaseLabel={t("equipments.electricVehicle.limitUp")}
            debounceMs={commitDelay}
            settleMs={CHARGE_LIMIT_SETTLE_MS}
            onCommit={commitLimit}
          />
        </div>
      )}

      {outcome && (
        <span className={`text-caption ${outcome.ok ? "text-success" : "text-error"}`}>
          {outcome.text}
        </span>
      )}

      {(s.mileageKm !== null || extraData.length > 0) && (
        <div className="flex flex-col gap-1 pt-3 border-t border-border-light">
          {s.mileageKm !== null && (
            <div className="flex items-center justify-between gap-3 text-small">
              <span className="text-text-secondary">{t("equipments.electricVehicle.mileage")}</span>
              <span className="tabular-nums text-text">
                {formatWithUnit(s.mileageKm, "km")}
              </span>
            </div>
          )}
          {extraData.map((b) => (
            <div key={b.alias} className="flex items-center justify-between gap-3 text-small">
              <span className="text-text-secondary">{extraLabel("equipments.electricVehicle", b.alias, t)}</span>
              <span className="tabular-nums text-text">
                {typeof b.value === "string"
                  ? extraTextValue("equipments.electricVehicle", b.alias, b.value, t)
                  : formatValue(b.value, b.unit)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
