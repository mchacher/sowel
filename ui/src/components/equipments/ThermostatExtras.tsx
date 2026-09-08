import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, SlidersHorizontal, Zap } from "lucide-react";
import type { DataBindingWithValue, OrderBindingWithDetails } from "../../types";
import { splitThermostatExtras } from "../../lib/thermostat-contract";
import { humanizeAlias } from "../../lib/humanize-alias";

/**
 * Spec 177 — everything bound on a thermostat that is not the core, rendered
 * from what is actually bound and nothing else. No alias is named in this
 * file: a Panasonic ioniser, a pellet stove's programme and a vendor Sowel
 * has never met all go through the same four shapes, chosen by the order's
 * type. Labels are dictionary lookups with a humanised fallback, never
 * layout.
 *
 *   order `enum`                        → segmented buttons
 *   order `boolean` + same-alias data   → toggle
 *   order `boolean`, no data mirror     → momentary action button (sends true)
 *   order `number`                      → stepper bounded by min/max
 *   data with no same-alias order       → read-only chip
 */

interface ThermostatExtrasProps {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  /** The card's optimistic overlay, keyed by alias. */
  optimistic: Record<string, unknown>;
  executing: string | null;
  onExec: (alias: string, value: unknown) => void;
}

function isControllable(order: OrderBindingWithDetails): boolean {
  if (order.type === "enum") return (order.enumValues?.length ?? 0) > 0;
  return order.type === "boolean" || order.type === "number";
}

const chip = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px] bg-border-light text-text-secondary";
const segment = (selected: boolean) =>
  `px-2.5 py-1 rounded-[6px] text-[11px] font-medium border transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    selected
      ? "bg-primary/10 text-primary border-primary/30"
      : "bg-surface text-text-tertiary border-border hover:text-text-secondary"
  }`;

export function ThermostatExtras({
  dataBindings,
  orderBindings,
  optimistic,
  executing,
  onExec,
}: ThermostatExtrasProps) {
  const { t } = useTranslation();

  const { extraData, extraOrders } = splitThermostatExtras(dataBindings, orderBindings);
  // A control's mirror is the data binding of the same alias, wherever it
  // lives: a legacy `state` ORDER (bound before the toggle_power → power
  // override) mirrors the core `state` reading and must render as a toggle,
  // not as a one-shot that can only send true.
  const dataByAlias = new Map(dataBindings.map((b) => [b.alias, b]));
  const controls = extraOrders.filter(isControllable);
  // A reading whose order has no generic control (text/json) still shows as
  // a chip rather than vanishing with it.
  const controlAliases = new Set(controls.map((o) => o.alias));
  const readings = extraData.filter((b) => !controlAliases.has(b.alias));

  if (controls.length === 0 && readings.length === 0) return null;

  const label = (alias: string) => t(`thermostat.extras.${alias}`, { defaultValue: humanizeAlias(alias) });
  const valueLabel = (alias: string, value: unknown, unit?: string): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? t("common.on") : t("common.off");
    if (typeof value === "number") {
      const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return unit ? `${n} ${unit}` : n;
    }
    const s = String(value);
    return t(`thermostat.values.${alias}.${s}`, { defaultValue: s });
  };
  const current = (alias: string): unknown =>
    alias in optimistic ? optimistic[alias] : dataByAlias.get(alias)?.value;

  return (
    <div className="pt-3 border-t border-border space-y-2.5">
      <span className="text-[12px] text-text-tertiary flex items-center gap-1">
        <SlidersHorizontal size={12} strokeWidth={1.5} />
        {t("thermostat.extras.title")}
      </span>

      {controls.map((order) => {
        const alias = order.alias;
        const value = current(alias);
        const busy = executing === alias;

        if (order.type === "enum") {
          return (
            <div key={alias} className="space-y-1.5">
              <span className="text-[12px] text-text-tertiary">{label(alias)}</span>
              <div className="flex gap-1.5 flex-wrap">
                {(order.enumValues ?? []).map((v) => (
                  <button
                    key={v}
                    onClick={() => onExec(alias, v)}
                    disabled={busy}
                    className={segment(value === v)}
                  >
                    {valueLabel(alias, v)}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (order.type === "boolean") {
          const mirror = dataByAlias.get(alias);
          if (!mirror) {
            return (
              <div key={alias} className="flex items-center gap-3">
                <span className="text-[12px] text-text-tertiary">{label(alias)}</span>
                <button
                  onClick={() => onExec(alias, true)}
                  disabled={busy}
                  className={segment(false)}
                  title={label(alias)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Zap size={11} strokeWidth={1.5} />
                    {t("thermostat.extras.trigger")}
                  </span>
                </button>
              </div>
            );
          }
          const on = value === true;
          return (
            <div key={alias} className="flex items-center gap-3">
              <span className="text-[12px] text-text-tertiary">{label(alias)}</span>
              <button
                onClick={() => onExec(alias, !on)}
                disabled={busy}
                className={segment(on)}
                title={on ? t("controls.turnOff") : t("controls.turnOn")}
              >
                {on ? t("common.on") : t("common.off")}
              </button>
            </div>
          );
        }

        // number
        const n = typeof value === "number" ? value : null;
        const min = order.min ?? Number.NEGATIVE_INFINITY;
        const max = order.max ?? Number.POSITIVE_INFINITY;
        return (
          <div key={alias} className="flex items-center gap-3">
            <span className="text-[12px] text-text-tertiary">{label(alias)}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => n !== null && onExec(alias, n - 1)}
                disabled={busy || n === null || n - 1 < min}
                className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title={`${label(alias)} −`}
              >
                <ChevronDown size={12} strokeWidth={2} />
              </button>
              <span className="text-[13px] font-semibold text-text tabular-nums font-mono min-w-[40px] text-center">
                {valueLabel(alias, n, order.unit)}
              </span>
              <button
                onClick={() => n !== null && onExec(alias, n + 1)}
                disabled={busy || n === null || n + 1 > max}
                className="p-1 rounded-[4px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title={`${label(alias)} +`}
              >
                <ChevronUp size={12} strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}

      {readings.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {readings.map((b) => (
            <span key={b.alias} className={chip} title={b.alias}>
              <span className="text-text-tertiary">{label(b.alias)}</span>
              <span className="font-medium text-text">{valueLabel(b.alias, b.value, b.unit)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
