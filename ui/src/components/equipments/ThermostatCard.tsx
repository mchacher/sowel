import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Power, Snowflake, Sun, Droplets, Fan, Zap, Thermometer } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { thermostatPowerStateBinding } from "../../lib/thermostat-state";
import { THERMOSTAT_STATE_ALIAS } from "../../lib/binding-candidates";
import { ThermostatExtras } from "./ThermostatExtras";
import { formatNumber, formatTemperature } from "../../lib/format";
import { SetpointStepper } from "./SetpointStepper";
import { resolveSetpoint } from "./setpoint";
import { useSetpointCommitDelay } from "../../hooks/useSetpointCommit";

/** How long an optimistic control value may outlive its confirmation. */
const OPTIMISTIC_TTL_MS = 90_000;

interface ThermostatCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

// Spec 177 — the `operationMode` vocabulary (OPERATION_MODE_VALUES). A value
// outside it renders its raw name with the neutral style: the card never
// hides a mode it does not know, and never keys a layout off a vendor value.
const MODE_ICONS: Record<string, React.ReactNode> = {
  auto: <Zap size={14} strokeWidth={1.5} />,
  cool: <Snowflake size={14} strokeWidth={1.5} />,
  heat: <Sun size={14} strokeWidth={1.5} />,
  dry: <Droplets size={14} strokeWidth={1.5} />,
  fan: <Fan size={14} strokeWidth={1.5} />,
  off: <Power size={14} strokeWidth={1.5} />,
};

const MODE_COLORS: Record<string, string> = {
  auto: "bg-primary/10 text-primary border-primary/30",
  cool: "bg-primary/10 text-primary border-primary/30",
  heat: "bg-heat/10 text-heat border-heat/30",
  dry: "bg-success/10 text-success border-success/30",
  fan: "bg-text-tertiary/10 text-text-secondary border-text-tertiary/30",
  off: "bg-border-light text-text-tertiary border-border",
};

export function ThermostatCard({ equipment, onExecuteOrder, compact }: ThermostatCardProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);

  // Optimistic overrides — applied immediately, cleared when real data arrives
  const [optimistic, setOptimistic] = useState<Record<string, unknown>>({});
  const prevBindingsRef = useRef(equipment.dataBindings);
  const optimisticTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dropOptimistic = (alias: string) => {
    const timer = optimisticTimers.current.get(alias);
    if (timer) {
      clearTimeout(timer);
      optimisticTimers.current.delete(alias);
    }
    setOptimistic((prev) => {
      if (!(alias in prev)) return prev;
      const next = { ...prev };
      delete next[alias];
      return next;
    });
  };

  useEffect(() => {
    const timers = optimisticTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Clear an optimistic value when ITS mirror binding is re-reported — the
  // truth then either confirms it (same value) or reverts it (the device did
  // not obey). Clearing everything on any change, as this used to, let the
  // submeter clamp (which pushes a wattage every few seconds) wipe the
  // optimistic power state long before a cloud thermostat's next poll could
  // confirm it, so the toggle snapped back to "off" seconds after every tap.
  // A key whose mirror never reports (no binding at all, device offline) is
  // bounded by the TTL armed in exec, not held forever.
  useEffect(() => {
    const prev = prevBindingsRef.current;
    prevBindingsRef.current = equipment.dataBindings;
    setOptimistic((current) => {
      const keys = Object.keys(current);
      if (keys.length === 0) return current;
      const reported = new Set(
        equipment.dataBindings
          .filter((b) => {
            const old = prev.find((p) => p.alias === b.alias);
            return (
              old !== undefined && (old.value !== b.value || old.lastUpdated !== b.lastUpdated)
            );
          })
          .map((b) => b.alias),
      );
      // The `power` order is mirrored by the boolean run-state binding
      // (the `state` alias on a submetered thermostat). When no such binding
      // exists, the mirror is the not-yet-bound state alias, NEVER the
      // numeric `power` binding: the clamp's wattage pushes must not wipe
      // the optimistic toggle on an equipment that has no state to confirm
      // it with — that was the original symptom.
      const stateBinding = thermostatPowerStateBinding(equipment.dataBindings);
      const mirrorOf = (alias: string) =>
        alias === "power" ? (stateBinding?.alias ?? THERMOSTAT_STATE_ALIAS) : alias;
      const next: Record<string, unknown> = { ...current };
      let touched = false;
      for (const k of keys) {
        if (reported.has(mirrorOf(k))) {
          delete next[k];
          touched = true;
          const timer = optimisticTimers.current.get(k);
          if (timer) {
            clearTimeout(timer);
            optimisticTimers.current.delete(k);
          }
        }
      }
      return touched ? next : current;
    });
  }, [equipment.dataBindings]);

  // The core (spec 177): temperature, outsideTemperature, setpoint, state,
  // power, operationMode. Everything else bound on this equipment is an extra
  // and is rendered generically by <ThermostatExtras> below — no vendor alias
  // is read here.
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "operationMode");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const outsideTempBinding = equipment.dataBindings.find((b) => b.alias === "outsideTemperature");

  // The run state comes from the device's own boolean (the `state` alias on
  // a submetered thermostat, legacy boolean `power` otherwise). The `power`
  // alias on a submetered thermostat is a wattage, which `=== true` read as
  // permanently off — every tap then sent ON, and the toggle never settled.
  const isOn =
    "power" in optimistic
      ? optimistic.power === true
      : thermostatPowerStateBinding(equipment.dataBindings)?.value === true;
  const currentMode =
    "operationMode" in optimistic
      ? (optimistic.operationMode as string | null)
      : typeof modeBinding?.value === "string"
        ? modeBinding.value
        : null;
  // The setpoint has its own stepper (spec 196, slice 8a): one order after the
  // last tap, the requested value held until the device reports.
  const setpoint = resolveSetpoint(equipment);
  const commitDelay = useSetpointCommitDelay(equipment);
  const setpointOrder = setpoint.order;
  const commitSetpoint = (v: number) =>
    setpointOrder ? onExecuteOrder(setpointOrder, v) : Promise.resolve();
  const insideTemp = typeof insideTempBinding?.value === "number" ? insideTempBinding.value : null;
  const outsideTemp =
    typeof outsideTempBinding?.value === "number" ? outsideTempBinding.value : null;

  // Core order bindings (available controls)
  const hasPowerOrder = equipment.orderBindings.some((o) => o.alias === "power");
  const modeOrder = equipment.orderBindings.find((o) => o.alias === "operationMode");

  const availableModes = modeOrder?.enumValues ?? [];

  const exec = async (alias: string, value: unknown) => {
    if (executing) return;
    // Apply optimistic update immediately, bounded by a TTL: if nothing ever
    // re-reports the mirror (no state binding yet, device offline, order
    // rejected upstream), the card falls back to the truth instead of
    // showing a stale optimistic state forever. 90 s covers the Panasonic
    // plugin's on-demand polls (10 s + 45 s) with margin.
    setOptimistic((prev) => ({ ...prev, [alias]: value }));
    const existing = optimisticTimers.current.get(alias);
    if (existing) clearTimeout(existing);
    optimisticTimers.current.set(
      alias,
      setTimeout(() => dropOptimistic(alias), OPTIMISTIC_TTL_MS),
    );
    setExecuting(alias);
    try {
      await onExecuteOrder(alias, value);
    } catch {
      // Revert optimistic on error
      dropOptimistic(alias);
    } finally {
      setExecuting(null);
    }
  };

  if (compact) {
    return (
      <CompactThermostat
        isOn={isOn}
        insideTemp={insideTemp}
        setpoint={
          setpointOrder && setpoint.value !== null ? (
            <SetpointStepper
              size="sm"
              value={setpoint.value}
              min={setpoint.min}
              max={setpoint.max}
              step={setpoint.step}
              unit="°C"
              label={t("thermostat.target")}
              debounceMs={commitDelay}
              onCommit={commitSetpoint}
            />
          ) : null
        }
        hasPowerOrder={hasPowerOrder}
        executing={executing}
        onTogglePower={() => exec("power", !isOn)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Temperature display + Power */}
      <div className="flex items-center justify-between">
        <div className="flex items-end gap-3">
          <div className="text-value font-semibold text-text leading-none tabular-nums">
            {formatNumber(insideTemp, { decimals: 1 })}
            <span className="text-lead text-text-tertiary font-normal">°C</span>
          </div>
          {outsideTemp !== null && (
            <div className="text-small text-text-tertiary mb-1">
              {t("thermostat.outside")}
              {t("common.colon")}
              {formatTemperature(outsideTemp)}
            </div>
          )}
        </div>
        {hasPowerOrder && (
          <button
            onClick={() => exec("power", !isOn)}
            disabled={executing === "power"}
            className={`
              p-2.5 rounded-sm transition-colors duration-150 cursor-pointer
              ${
                isOn
                  ? "bg-primary-fill text-white hover:bg-primary-fill-hover"
                  : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            <Power size={18} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Target temperature control */}
      {setpointOrder && (
        <div className="flex items-center gap-3">
          <span className="text-caption text-text-tertiary">{t("thermostat.target")}</span>
          <SetpointStepper
            size="md"
            value={setpoint.value}
            min={setpoint.min}
            max={setpoint.max}
            step={setpoint.step}
            unit="°C"
            label={t("thermostat.target")}
            debounceMs={commitDelay}
            onCommit={commitSetpoint}
          />
        </div>
      )}

      {/* Mode selector */}
      {availableModes.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-caption text-text-tertiary">{t("thermostat.mode")}</span>
          <div className="flex gap-1.5 flex-wrap">
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => exec("operationMode", mode)}
                disabled={executing === "operationMode"}
                className={`
                  flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-caption font-medium border
                  transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                  ${
                    currentMode === mode
                      ? (MODE_COLORS[mode] ?? "bg-primary/10 text-primary border-primary/30")
                      : "bg-surface text-text-tertiary border-border hover:border-border hover:text-text-secondary"
                  }
                `}
              >
                {MODE_ICONS[mode]}
                {t(`thermostat.modes.${mode}`, { defaultValue: mode })}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Extras (spec 177) — whatever else is bound, rendered generically */}
      <ThermostatExtras
        dataBindings={equipment.dataBindings}
        orderBindings={equipment.orderBindings}
        optimistic={optimistic}
        executing={executing}
        onExec={(alias, value) => void exec(alias, value)}
        onCommitNumber={(alias, value) => onExecuteOrder(alias, value)}
        commitDelayMs={commitDelay}
        equipmentId={equipment.id}
      />
    </div>
  );
}

/** Compact inline thermostat for the Maison rows and the equipment list */
function CompactThermostat({
  isOn,
  insideTemp,
  setpoint,
  hasPowerOrder,
  executing,
  onTogglePower,
}: {
  isOn: boolean;
  insideTemp: number | null;
  /** The inline setpoint stepper, null when there is none to show. */
  setpoint: React.ReactNode;
  hasPowerOrder: boolean;
  executing: string | null;
  onTogglePower: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.preventDefault()}>
      {/* Current temp */}
      {insideTemp !== null && (
        <span className="flex items-center gap-0.5 text-caption text-text-tertiary tabular-nums">
          <Thermometer size={11} strokeWidth={1.5} />
          {formatTemperature(insideTemp, { style: "compact" })}
        </span>
      )}

      {/* Separator */}
      {setpoint && insideTemp !== null && <div className="w-px h-4 bg-border" />}

      {/* Target temp with − / + (spec 196, slice 8a: 44 px to the finger) */}
      {setpoint}

      {/* Power toggle */}
      {hasPowerOrder && (
        <>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePower();
            }}
            disabled={executing === "power"}
            className={`
              p-1.5 rounded-sm transition-colors duration-150 cursor-pointer
              ${
                isOn
                  ? "bg-primary-fill text-white hover:bg-primary-fill-hover"
                  : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            <Power size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>
  );
}
