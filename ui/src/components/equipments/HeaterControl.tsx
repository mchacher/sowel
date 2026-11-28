import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Snowflake, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import {
  PILOT_WIRE_ORDER_CATEGORY,
  isHeaterRunning,
  resolveHeaterState,
  type HeaterState,
  type PilotWireMode,
} from "../../lib/heater-contract";
import { heaterModeKey, heaterModeTint } from "./heaterMode";
import { findOrderByCategory } from "./bindingUtils";

interface HeaterControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
  /**
   * Compact only: draw the read-only state beside the control (default). The
   * Maison row draws it itself, as a reading that gives way first (#1163).
   */
  withReadings?: boolean;
}

function stateOf(equipment: EquipmentWithDetails): HeaterState {
  return resolveHeaterState(equipment.dataBindings, equipment.orderBindings);
}

/** The mode pill, as the compact rows show it. */
export function HeaterModeBadge({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const state = stateOf(equipment);
  return (
    <span
      className={`text-micro font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${heaterModeTint(state)}`}
    >
      {t(heaterModeKey(state.mode))}
    </span>
  );
}

/** Sends a pilot-wire mode under the alias of the bound order, one at a time. */
function usePilotWireOrder(
  equipment: EquipmentWithDetails,
  onExecuteOrder: HeaterControlProps["onExecuteOrder"],
) {
  const [pending, setPending] = useState<PilotWireMode | null>(null);
  const alias = equipment.orderBindings.find(
    (o) => o.category === PILOT_WIRE_ORDER_CATEGORY,
  )?.alias;
  const send = async (mode: PilotWireMode) => {
    if (pending || !alias || !equipment.enabled) return;
    setPending(mode);
    try {
      await onExecuteOrder(alias, mode);
    } finally {
      setPending(null);
    }
  };
  return { pending, send };
}

/** One button per mode the module accepts (spec 217). */
export function PilotWireModes({
  equipment,
  onExecuteOrder,
}: Pick<HeaterControlProps, "equipment" | "onExecuteOrder">) {
  const { t } = useTranslation();
  const state = stateOf(equipment);
  const { pending, send } = usePilotWireOrder(equipment, onExecuteOrder);
  if (state.wiring !== "pilot" || state.modes.length === 0 || !equipment.enabled) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {state.modes.map((mode) => {
        const active = state.mode === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            disabled={pending !== null}
            onClick={() => void send(mode)}
            className={`min-h-11 px-3 py-2 flex items-center justify-center gap-2 rounded-sm text-small font-medium border transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              active
                ? `${heaterModeTint(state)} border-current`
                : "border-border bg-surface text-text-secondary hover:border-primary/40"
            }`}
          >
            {pending === mode && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t(heaterModeKey(mode))}
          </button>
        );
      })}
    </div>
  );
}

function PilotWireSelect({
  equipment,
  onExecuteOrder,
}: Pick<HeaterControlProps, "equipment" | "onExecuteOrder">) {
  const { t } = useTranslation();
  const state = stateOf(equipment);
  const { pending, send } = usePilotWireOrder(equipment, onExecuteOrder);
  if (state.wiring !== "pilot" || state.modes.length === 0 || !equipment.enabled) return null;
  // A mode the module reports but does not accept is still what it is doing.
  const listed = state.mode !== null && state.modes.includes(state.mode);
  return (
    <select
      aria-label={t("controls.heater.mode")}
      value={state.mode ?? ""}
      disabled={pending !== null}
      onChange={(e) => {
        const mode = state.modes.find((m) => m === e.target.value);
        if (mode) void send(mode);
      }}
      className="px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text disabled:opacity-50"
    >
      {!listed && (
        <option value={state.mode ?? ""} disabled>
          {t(heaterModeKey(state.mode))}
        </option>
      )}
      {state.modes.map((mode) => (
        <option key={mode} value={mode}>
          {t(heaterModeKey(mode))}
        </option>
      ))}
    </select>
  );
}

export function HeaterControl(props: HeaterControlProps) {
  const { equipment, onExecuteOrder, compact, withReadings = true } = props;
  const { t } = useTranslation();
  const state = stateOf(equipment);
  if (state.wiring === "relay") return <RelayHeaterControl {...props} />;

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {withReadings && <HeaterModeBadge equipment={equipment} />}
        <PilotWireSelect equipment={equipment} onExecuteOrder={onExecuteOrder} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-md flex items-center justify-center ${heaterModeTint(state)}`}
        >
          {isHeaterRunning(state) ? (
            <Flame size={22} strokeWidth={1.5} />
          ) : (
            <Snowflake size={22} strokeWidth={1.5} />
          )}
        </div>
        <div className="text-lead font-medium text-text">{t(heaterModeKey(state.mode))}</div>
      </div>
      <PilotWireModes equipment={equipment} onExecuteOrder={onExecuteOrder} />
    </div>
  );
}

function RelayHeaterControl({
  equipment,
  onExecuteOrder,
  compact,
  withReadings = true,
}: HeaterControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  // Fil pilote convention: relay ON = éco, relay OFF = confort. No reading is
  // unknown (#1331): shown as such, and a tap puts the heater in comfort.
  const mode = stateOf(equipment).mode;
  const isOn = mode === "eco";
  const isComfort = mode === "comfort";

  // Category-first resolver: heater toggle is `toggle_power` / `light_toggle`
  // depending on the underlying device, with alias fallback for older
  // bindings (spec 110).
  const toggleBinding = findOrderByCategory(
    equipment.orderBindings,
    ["toggle_power", "light_toggle"],
    ["state"],
  );
  const hasToggle =
    !!toggleBinding && (toggleBinding.type === "enum" || toggleBinding.type === "boolean");

  const setRelayMode = async (target: "comfort" | "eco") => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      await onExecuteOrder(toggleBinding.alias, target === "eco" ? onVal : offVal);
    } finally {
      setExecuting(false);
    }
  };

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    await setRelayMode(isComfort ? "eco" : "comfort");
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {withReadings && <HeaterModeBadge equipment={equipment} />}

        {/* Toggle button */}
        {hasToggle && (
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`
              p-1.5 rounded-sm transition-colors duration-150 cursor-pointer
              ${
                isComfort
                  ? "bg-heat/10 text-heat hover:bg-heat/20"
                  : isOn
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "bg-border-light text-text-secondary hover:bg-border"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isComfort ? t("controls.heater.switchEco") : t("controls.heater.switchComfort")}
          >
            {executing ? (
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
            ) : isOn ? (
              <Snowflake size={14} strokeWidth={1.5} />
            ) : (
              <Flame size={14} strokeWidth={1.5} />
            )}
          </button>
        )}
      </div>
    );
  }

  // Full view
  return (
    <div className="space-y-4">
      {/* State display */}
      <div className="flex items-center gap-3">
        <div
          className={`
            w-10 h-10 rounded-md flex items-center justify-center
            ${heaterModeTint(stateOf(equipment))}
          `}
        >
          {isOn ? <Snowflake size={22} strokeWidth={1.5} /> : <Flame size={22} strokeWidth={1.5} />}
        </div>
        <div>
          <div className="text-lead font-medium text-text">{t(heaterModeKey(mode))}</div>
          {mode !== null && (
            <div className="text-caption text-text-tertiary">
              {isOn ? t("controls.heater.relayOn") : t("controls.heater.relayOff")}
            </div>
          )}
        </div>
      </div>

      {/* #1331 — no reading: both modes, chosen explicitly. */}
      {hasToggle && mode === null && (
        <div className="flex gap-2">
          <button
            onClick={() => void setRelayMode("comfort")}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium transition-colors duration-150 bg-heat/10 text-heat hover:bg-heat/20 disabled:opacity-50"
          >
            <Flame size={16} strokeWidth={1.5} /> {t("controls.heater.comfort")}
          </button>
          <button
            onClick={() => void setRelayMode("eco")}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium transition-colors duration-150 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <Snowflake size={16} strokeWidth={1.5} /> {t("controls.heater.eco")}
          </button>
        </div>
      )}

      {/* Toggle button */}
      {hasToggle && mode !== null && (
        <button
          onClick={handleToggle}
          disabled={executing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium
            transition-colors duration-150
            ${
              isComfort
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-heat/10 text-heat hover:bg-heat/20"
            }
            disabled:opacity-50
          `}
        >
          {isComfort ? (
            <>
              <Snowflake size={16} strokeWidth={1.5} /> {t("controls.heater.switchEco")}
            </>
          ) : (
            <>
              <Flame size={16} strokeWidth={1.5} /> {t("controls.heater.switchComfort")}
            </>
          )}
        </button>
      )}
    </div>
  );
}
