/**
 * UpsPanel (spec 156, redesigned in spec 157) — read-only detail panel for a
 * UPS equipment.
 *
 * Built on the shared FlowDiagram, because a UPS poses the same problem as a
 * solar installation: two sources, one load, and a path that switches. The
 * mapping is term for term — Maison/Réseau/Production becomes
 * Équipements/Secteur/Batterie, and the bottom edge that carries solar export
 * carries the battery charge here.
 *
 * The type has no order surface on purpose: an accidental shutdown order to a
 * UPS is unrecoverable, and the orderly-shutdown chain belongs to `upsmon` on
 * each protected host.
 *
 * Nothing is stated twice. The diagram carries the live values, one per node;
 * the margins card carries only the scales and thresholds, which appear
 * nowhere else; the technical sheet holds the nameplate.
 */

import { useTranslation } from "react-i18next";
import { Battery, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Server } from "lucide-react";
import { GridPylonIcon } from "../icons/GridPylonIcon";
import type { DataBindingWithValue } from "../../types";
import { FlowDiagram } from "../flow/FlowDiagram";
import type { FlowLinkSpec, FlowNodeSpec } from "../flow/flow-geometry";
import {
  formatRuntime,
  isOnBattery,
  readUpsBindings,
  upsMarginOf,
  upsSeverityOf,
  upsStatusKey,
  type UpsReadings,
} from "./upsStatus";

interface UpsPanelProps {
  dataBindings: DataBindingWithValue[];
}

const GRID_COLOR = "var(--color-energy-grid)";
const LOAD_COLOR = "var(--color-energy-hp)";
const BATTERY_COLOR = "var(--color-solar-auto)";
const IDLE_COLOR = "var(--color-text-tertiary)";

/** Values the diagram already shows, so the technical sheet never repeats them. */
const SHOWN_IN_DIAGRAM = new Set(["status", "battery", "battery_runtime", "load", "input_voltage"]);
/** Values the margins card already shows. */
const SHOWN_IN_MARGINS = new Set([
  "nominal_power",
  "transfer_low",
  "transfer_high",
  "input_voltage_nominal",
  "battery_charge_low",
  "battery_runtime_low",
]);

function severityColor(r: UpsReadings): string {
  const s = upsSeverityOf(r.status);
  if (s === "error") return "var(--color-error)";
  if (s === "warning") return "var(--color-warning)";
  if (s === "ok") return GRID_COLOR;
  return IDLE_COLOR;
}

export function UpsPanel({ dataBindings }: UpsPanelProps) {
  const { t } = useTranslation();
  const r = readUpsBindings(dataBindings);
  const onBattery = isOnBattery(r.status);
  const statusText = r.status ? t(upsStatusKey(r.status)) : (r.rawStatus ?? t(upsStatusKey(null)));
  const tagColor = severityColor(r);

  // The battery branch borrows the status severity: amber the moment the mains
  // is gone, red once the hardware calls the charge low.
  const batteryBranchColor = onBattery ? tagColor : BATTERY_COLOR;

  const nodes: FlowNodeSpec[] = [
    {
      slot: "focal",
      label: t("equipments.ups.node.load"),
      color: LOAD_COLOR,
      value: r.loadW !== null ? String(Math.round(r.loadW)) : (r.loadPct !== null ? String(r.loadPct) : "—"),
      unit: r.loadW !== null ? "W" : r.loadPct !== null ? "%" : undefined,
      icon: <Server className="w-11 h-11 sm:w-14 sm:h-14" strokeWidth={1.5} />,
    },
    {
      slot: "left",
      label: t("equipments.ups.node.mains"),
      color: onBattery ? IDLE_COLOR : GRID_COLOR,
      dimmed: onBattery,
      value: onBattery ? t("equipments.ups.absent") : r.inputV !== null ? String(Math.round(r.inputV)) : "—",
      unit: onBattery || r.inputV === null ? undefined : "V",
      icon: <GridPylonIcon className="w-9 h-9 sm:w-10 sm:h-10" />,
    },
    {
      slot: "right",
      label: t("equipments.ups.node.battery"),
      color: batteryBranchColor,
      // On mains with a full battery there is nothing happening here, so the
      // node steps back the way the grid node does when it is not drawing.
      dimmed: !onBattery && !r.charging,
      value: r.chargePct !== null ? String(Math.round(r.chargePct)) : "—",
      unit: r.chargePct !== null ? "%" : undefined,
      sub: onBattery
        ? t("equipments.ups.discharging")
        : (formatRuntime(r.runtimeS) ?? undefined),
      icon: batteryIcon(r.chargePct),
    },
  ];

  const runtimeLabel = formatRuntime(r.runtimeS);
  const links: FlowLinkSpec[] = [
    {
      edge: "leftToFocal",
      color: GRID_COLOR,
      active: !onBattery && r.status !== "offline",
      magnitude: r.loadW ?? undefined,
    },
    {
      edge: "rightToFocal",
      color: batteryBranchColor,
      active: onBattery,
      magnitude: r.loadW ?? undefined,
      // During an outage the autonomy is the only number worth reading, and it
      // sits where the solar page puts its share-of-supply percentage.
      ...(onBattery && runtimeLabel
        ? { pill: { text: runtimeLabel, color: batteryBranchColor } }
        : {}),
    },
    {
      edge: "leftToRight",
      color: BATTERY_COLOR,
      active: r.charging && !onBattery,
      ...(r.charging && !onBattery
        ? { pill: { text: t("equipments.ups.charging"), color: BATTERY_COLOR } }
        : {}),
    },
  ];

  const ariaLabel = onBattery
    ? t("equipments.ups.aria.onBattery", {
        charge: r.chargePct ?? "?",
        runtime: runtimeLabel ?? "?",
        load: r.loadW ?? "?",
      })
    : t("equipments.ups.aria.onMains", {
        volts: r.inputV ?? "?",
        load: r.loadW ?? "?",
        charge: r.chargePct ?? "?",
      });

  const margin = upsMarginOf(r);
  const marginColor =
    margin === "critical"
      ? "var(--color-error)"
      : margin === "tight"
        ? "var(--color-warning)"
        : "var(--color-success)";

  const sheetRows = dataBindings.filter(
    (b) => !SHOWN_IN_DIAGRAM.has(b.alias) && !SHOWN_IN_MARGINS.has(b.alias),
  );

  const hasMargins =
    (r.transferLow !== null && r.transferHigh !== null) ||
    r.nominalW !== null ||
    r.chargeLowPct !== null ||
    r.runtimeLowS !== null;

  return (
    <div className="mb-6 space-y-4">
      <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
        <FlowDiagram
          nodes={nodes}
          links={links}
          tag={{ text: statusText, color: tagColor }}
          ariaLabel={ariaLabel}
        />
      </div>

      {hasMargins && (
        <div className="bg-surface border border-border rounded-[10px]">
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div>
              <h3 className="text-[15px] font-semibold text-text">
                {t("equipments.ups.margins.title")}
              </h3>
              <p className="text-[13px] text-text-tertiary mt-0.5">
                {t("equipments.ups.margins.help")}
              </p>
            </div>
            <span
              className="font-mono text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
              style={{ color: marginColor, background: `color-mix(in srgb, ${marginColor} 12%, transparent)` }}
            >
              {t(`equipments.ups.margins.${margin}`)}
            </span>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary px-5 pb-2">
                  {t("equipments.ups.margins.threshold")}
                </th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary px-5 pb-2">
                  {t("equipments.ups.margins.setting")}
                </th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-widest text-text-tertiary px-5 pb-2">
                  {t("equipments.ups.margins.position")}
                </th>
              </tr>
            </thead>
            <tbody>
              {r.transferLow !== null && r.transferHigh !== null && (
                <MarginRow
                  label={t("equipments.ups.margins.transfer")}
                  setting={`${r.transferLow} – ${r.transferHigh} V`}
                >
                  <RangeTrack
                    low={r.transferLow}
                    high={r.transferHigh}
                    value={onBattery ? null : r.inputV}
                    nominal={r.nominalV}
                  />
                </MarginRow>
              )}
              {r.nominalW !== null && (
                <MarginRow
                  label={t("equipments.ups.margins.capacity")}
                  setting={`${r.nominalW} W`}
                >
                  <FillTrack pct={r.loadPct} />
                </MarginRow>
              )}
              {(r.chargeLowPct !== null || r.runtimeLowS !== null) && (
                <MarginRow
                  label={t("equipments.ups.margins.shutdown")}
                  setting={[
                    r.chargeLowPct !== null ? `${r.chargeLowPct} %` : null,
                    r.runtimeLowS !== null ? formatRuntime(r.runtimeLowS) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <span className="text-[12px] text-text-tertiary">
                    {t("equipments.ups.margins.shutdownHelp")}
                  </span>
                </MarginRow>
              )}
            </tbody>
          </table>
        </div>
      )}

      {sheetRows.length > 0 && (
        <details className="bg-surface border border-border rounded-[10px] group">
          <summary className="flex items-center gap-2 px-5 py-3 text-[13px] text-text-secondary cursor-pointer list-none">
            <span className="text-text-tertiary transition-transform group-open:rotate-90">▸</span>
            {t("equipments.ups.sheet.title")}
            <span className="ml-auto text-[12px] text-text-tertiary">
              {t("equipments.ups.sheet.count", { count: sheetRows.length })}
            </span>
          </summary>
          <div className="border-t border-border-light divide-y divide-border-light">
            {sheetRows.map((b) => (
              <div key={b.id} className="flex items-baseline justify-between gap-4 px-5 py-2">
                <span className="text-[13px] text-text-secondary">
                  {t(`equipments.ups.field.${b.alias}`, b.alias)}
                </span>
                <span className="text-[13px] font-mono text-text tabular-nums">
                  {formatSheetValue(b.value, b.unit)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Battery glyph matching the charge, so the level reads before the number does.
 * Mirrors the low-battery thresholds the engine already uses (spec 143).
 */
function batteryIcon(pct: number | null) {
  const cls = "w-9 h-9 sm:w-10 sm:h-10";
  if (pct === null) return <Battery className={cls} strokeWidth={1.5} />;
  if (pct <= 20) return <BatteryWarning className={cls} strokeWidth={1.5} />;
  if (pct <= 50) return <BatteryLow className={cls} strokeWidth={1.5} />;
  if (pct < 95) return <BatteryMedium className={cls} strokeWidth={1.5} />;
  return <BatteryFull className={cls} strokeWidth={1.5} />;
}

function formatSheetValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  return unit ? `${String(value)} ${unit}` : String(value);
}

function MarginRow({
  label,
  setting,
  children,
}: {
  label: string;
  setting: string;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td className="px-5 py-2.5 border-t border-border-light text-[13px] font-medium text-text">
        {label}
      </td>
      <td className="px-5 py-2.5 border-t border-border-light text-[13px] font-mono text-text tabular-nums whitespace-nowrap">
        {setting}
      </td>
      <td className="px-5 py-2.5 border-t border-border-light text-right">{children}</td>
    </tr>
  );
}

/** Where a live reading sits inside the window that triggers a transfer. */
function RangeTrack({
  low,
  high,
  value,
  nominal,
}: {
  low: number;
  high: number;
  value: number | null;
  nominal: number | null;
}) {
  const span = high - low;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - low) / span) * 100))}%`;
  return (
    <div className="relative inline-block w-[130px] h-1.5 rounded-full bg-border-light align-middle">
      {nominal !== null && span > 0 && (
        <span
          className="absolute top-0 w-px h-1.5 bg-text-tertiary opacity-60"
          style={{ left: pos(nominal) }}
        />
      )}
      {value !== null && span > 0 && (
        <span
          className="absolute -top-[3px] w-3 h-3 -ml-1.5 rounded-full ring-2 ring-surface"
          style={{ left: pos(value), background: GRID_COLOR }}
        />
      )}
    </div>
  );
}

function FillTrack({ pct }: { pct: number | null }) {
  return (
    <div className="relative inline-block w-[130px] h-1.5 rounded-full bg-border-light align-middle overflow-hidden">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: LOAD_COLOR }}
      />
    </div>
  );
}
