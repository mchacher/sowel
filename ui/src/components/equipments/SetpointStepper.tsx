import { useEffect, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { useSetpointCommit } from "../../hooks/useSetpointCommit";
import { CLOUD_COMMIT_DELAY_MS } from "./setpoint";
import { formatWithUnit, roundTo } from "../../lib/format";

export type SetpointStepperSize = "sm" | "md" | "lg";

export interface SetpointStepperProps {
  /** The device's value. */
  value: number | null;
  min: number;
  max: number;
  /** Default 0.5. */
  step?: number;
  /** Formats the value by its unit (lib/format): « 20,0 °C », « 16 A », « 80 % ». */
  unit?: string;
  /** sm: inline row (28 px drawn, 44 px to the finger); md: 44 px; lg: 56 px (sheet). */
  size: SetpointStepperSize;
  /**
   * « 20,5° » or « 20,5 °C » (decision pr3-degre: compact in tiles, rows and
   * strips, full in pages). Defaults to compact for `sm`, full otherwise; a
   * dashboard tile passes "compact" so its setpoint matches the temperature
   * beside it (#1129).
   */
  valueStyle?: "compact" | "full";
  onCommit: (value: number) => Promise<void>;
  disabled?: boolean;
  /** What is set, for the accessible names: « Consigne », « Courant de charge ». */
  label: string;
  /** Accessible names of the buttons; default « Baisser / Augmenter la consigne ». */
  decreaseLabel?: string;
  increaseLabel?: string;
  /** From `useSetpointCommitDelay`: ~600 ms for a cloud device, ~150 ms local. */
  debounceMs?: number;
  settleMs?: number;
  /**
   * For an average (a zone): keep the requested value until the value reaches it
   * (± half a step) or the timeout, not just until the first report.
   */
  holdUntilReached?: boolean;
  /** First value proposed when the device has none yet; without it the buttons wait for one. */
  startValue?: number;
  /**
   * Whether a failure writes « Consigne non appliquée » under the control.
   * Default: yes above `sm`. A parent that already writes the device's own
   * reason passes false, so the failure is said once (#1129); the value still
   * turns red.
   */
  errorLine?: boolean;
  /** Lets a parent draw the value being set elsewhere (a thermometer's level). */
  onShownChange?: (value: number | null) => void;
  className?: string;
}

const BUTTON: Record<SetpointStepperSize, string> = {
  // 28 px drawn, 44 px under the finger (hit-44), fits a 52 px Maison row.
  sm: "hit-44 w-7 h-7 rounded-sm text-text-secondary hover:bg-border-light hover:text-text",
  md: "min-w-11 min-h-11 rounded-sm border border-border bg-surface text-text-secondary hover:bg-border-light hover:text-text",
  lg: "w-14 h-14 rounded-sm border border-border bg-surface text-text-secondary hover:bg-border-light",
};
const ICON: Record<SetpointStepperSize, number> = { sm: 14, md: 16, lg: 20 };
const VALUE: Record<SetpointStepperSize, string> = {
  sm: "text-body min-w-[48px]",
  md: "text-title min-w-[72px]",
  lg: "text-display min-w-[104px]",
};
const GAP: Record<SetpointStepperSize, string> = {
  sm: "gap-0.5 pointer-coarse:gap-2",
  md: "gap-2",
  lg: "gap-4",
};

/**
 * Spec 196, slice 8a — the one setpoint control: thermostat and pool heat pump
 * setpoints, EV charge current and charge limit, numeric thermostat extras.
 * Taps show at once, one order leaves after the last tap (`useSetpointCommit`).
 */
export function SetpointStepper({
  value,
  min,
  max,
  step = 0.5,
  unit,
  size,
  valueStyle = size === "sm" ? "compact" : "full",
  onCommit,
  disabled = false,
  label,
  decreaseLabel,
  increaseLabel,
  debounceMs = CLOUD_COMMIT_DELAY_MS,
  settleMs,
  holdUntilReached = false,
  startValue,
  errorLine = size !== "sm",
  onShownChange,
  className = "",
}: SetpointStepperProps) {
  const { t } = useTranslation();
  const { shown, pending, error, request } = useSetpointCommit({
    value,
    onCommit,
    debounceMs,
    settleMs,
    settleTolerance: holdUntilReached ? step / 2 : undefined,
  });

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  const decimals = step % 1 === 0 ? 0 : 2;
  const next = (direction: -1 | 1): number | null => {
    if (shown === null) return startValue ?? null;
    const raw = Math.round((shown + direction * step) / step) * step;
    const v = roundTo(Math.min(max, Math.max(min, raw)), decimals);
    return v === shown ? null : v;
  };
  const down = next(-1);
  const up = next(1);

  const tap = (target: number | null) => (e: MouseEvent) => {
    // Rows and tiles are links or buttons themselves: the tap is the stepper's.
    e.preventDefault();
    e.stopPropagation();
    if (target !== null) request(target);
  };

  const buttonClass = `${BUTTON[size]} flex items-center justify-center transition-colors cursor-pointer active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed`;
  const text = shown === null ? "—" : formatWithUnit(shown, unit, { style: valueStyle });

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className={`hit-group flex items-center ${GAP[size]}`}>
        <button
          type="button"
          onClick={tap(down)}
          disabled={disabled || down === null}
          aria-label={decreaseLabel ?? t("thermostat.setpointDown")}
          className={buttonClass}
        >
          <Minus size={ICON[size]} strokeWidth={1.5} />
        </button>
        <span
          aria-live="polite"
          title={error ? t("setpoint.failed") : undefined}
          className={`${VALUE[size]} inline-flex items-center justify-center gap-1 font-semibold tabular-nums ${
            error ? "text-error" : pending ? "text-primary" : "text-text"
          }`}
        >
          <span className="sr-only">{label} </span>
          {text}
          {pending && (
            <span data-testid="setpoint-pending" className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </span>
        <button
          type="button"
          onClick={tap(up)}
          disabled={disabled || up === null}
          aria-label={increaseLabel ?? t("thermostat.setpointUp")}
          className={buttonClass}
        >
          <Plus size={ICON[size]} strokeWidth={1.5} />
        </button>
      </div>
      {/* The row (sm) has no room for a line: its value turns red, titled. */}
      {error && errorLine && (
        <span role="status" className="text-caption text-error mt-1">
          {t("setpoint.failed")}
        </span>
      )}
    </div>
  );
}
