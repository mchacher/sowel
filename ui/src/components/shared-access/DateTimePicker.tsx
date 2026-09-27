import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Bounds,
  type Wall,
  hourOptions,
  isDayAllowed,
  makeWall,
  minuteOptions,
  snapInto,
  wallHour,
  wallMinute,
} from "../../lib/shared-access-period";
import { inputCls, Refusal } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * R7.29 — a day from the calendar, then the time from two standard lists:
 * hours, and minutes in steps of five. Every day before the bound is refused
 * (struck by `min` in the native calendar, and refused aloud if typed), and on
 * the bound's own day the hours and minutes before it are disabled.
 */
export function DateTimePicker({
  value,
  onChange,
  bounds = {},
  label,
  disabled,
  dayRefusedText,
}: {
  value: Wall;
  onChange: (next: Wall) => void;
  bounds?: Bounds;
  label: string;
  disabled?: boolean;
  /** What to say when a typed day is out of bounds; « before the start » by default. */
  dayRefusedText?: string;
}) {
  const { t } = useTranslation();
  const [refused, setRefused] = useState<string | null>(null);
  const hour = wallHour(value);
  const minute = wallMinute(value);
  const hours = hourOptions(value.date, bounds);
  const minutes = minuteOptions(value.date, hour, bounds, minute);

  const pickDay = (date: string) => {
    if (!date) return;
    if (!isDayAllowed(date, bounds)) {
      setRefused(date);
      return;
    }
    setRefused(null);
    onChange(snapInto({ date, time: value.time }, bounds));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={label}>
        <input
          type="date"
          className={inputCls}
          value={value.date}
          min={bounds.min?.date}
          max={bounds.max?.date}
          disabled={disabled}
          aria-label={t("sharedAccess.picker.day", { label })}
          onChange={(e) => pickDay(e.target.value)}
        />
        <select
          className={inputCls}
          value={hour}
          disabled={disabled}
          aria-label={t("sharedAccess.picker.hour", { label })}
          onChange={(e) => onChange(snapInto(makeWall(value.date, Number(e.target.value), minute), bounds))}
        >
          {hours.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {pad(o.value)} h
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={minute}
          disabled={disabled}
          aria-label={t("sharedAccess.picker.minute", { label })}
          onChange={(e) => onChange(makeWall(value.date, hour, Number(e.target.value)))}
        >
          {minutes.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {pad(o.value)}
            </option>
          ))}
        </select>
      </div>
      {refused && <Refusal>{dayRefusedText ?? t("sharedAccess.picker.dayRefused")}</Refusal>}
    </div>
  );
}
