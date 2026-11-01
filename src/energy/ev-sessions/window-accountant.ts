/**
 * Spec 191 — the energy of an open charge session, by 5-minute windows.
 *
 * Pure: no clock, no bus, no database. The tracker feeds it the charger's
 * power and energy, with their times, and collects every window that closed:
 * the car's draw per window. The house's grid import per window is kept apart
 * (`house-grid.ts`) and shared between the sessions of that window when the
 * tracker settles it (`poolImport`), once the grid readings covering it are
 * in.
 *
 * Why 5 minutes and not 1: the grid meter reports about once a minute with some
 * jitter, so a 1-minute window would regularly hold no grid reading at all and
 * be counted all grid ("never invent solar"). Over 5 minutes that only happens
 * when the meter is really silent.
 *
 * The car's draw over a window comes from its `power`, held from one report to
 * the next (a charger may report only on change), and held at most
 * `HOLD_LIMIT_MS` after the charger's last report of any kind, so an offline
 * charger stops counting. A charger that never reported a power in the session
 * is measured by its `energy` deltas instead; once it has, power alone is used,
 * so a late energy tick is never counted twice.
 */

export const WINDOW_S = 300;
export const HOLD_LIMIT_MS = 15 * 60_000;

/** What one window measured of the car. */
export interface CarWindow {
  /** Window start, epoch seconds. */
  startS: number;
  /** Window length actually covered, seconds (shorter for the last one). */
  lengthS: number;
  /** The car's draw (Wh). */
  carWh: number;
  /** The part of the window the session covered (epoch ms): less in its first and last. */
  fromMs: number;
  toMs: number;
}

/** A window ready to price: the car's draw and its share of the house import. */
export interface WindowMeasure extends CarWindow {
  /** This car's share of the grid import (Wh); null when the meter said nothing. */
  importWh: number | null;
}

/**
 * Audit A2 — several sessions in one window share the house's import: the
 * cars together take `min(Σcar, import)` (served last by the sun, P5), split
 * pro rata of their draw. Null stays null (no reading: all grid).
 */
export function poolImport(
  carsWh: readonly number[],
  ownImports: readonly number[],
  windowImportWh: number | null,
): (number | null)[] {
  if (windowImportWh === null) return carsWh.map(() => null);
  const total = carsWh.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return carsWh.map(() => 0);
  // Together the cars take at most what the house imported while any of them
  // drew; each at most what it imported during its own part of the window
  // (the house before the plug-in is not the car's, audit review).
  // A car capped by its own part hands what it cannot take back to the
  // others (water-filling), so imported energy never reads as solar.
  const caps = carsWh.map((c, i) => Math.min(c, Math.max(0, ownImports[i] ?? 0)));
  const shares = carsWh.map(() => 0);
  let left = Math.min(total, Math.max(0, windowImportWh));
  let open = carsWh.map((_, i) => i).filter((i) => caps[i] > 0);
  while (left > 1e-9 && open.length > 0) {
    const weight = open.reduce((a, i) => a + carsWh[i], 0);
    const capped: number[] = [];
    let given = 0;
    for (const i of open) {
      const want = (left * carsWh[i]) / weight;
      const take = Math.min(want, caps[i] - shares[i]);
      shares[i] += take;
      given += take;
      if (caps[i] - shares[i] <= 1e-9) capped.push(i);
    }
    left -= given;
    if (capped.length === 0) break;
    open = open.filter((i) => !capped.includes(i));
  }
  return shares;
}

export class WindowAccountant {
  private windowStartS: number;
  /** The session's start within its first window (later windows: their start). */
  private coveredFromMs: number;
  private powerWh = 0;
  private energyWh = 0;
  private lastPowerW: number | null = null;
  private lastPowerAtMs: number | null = null;
  private lastReportAtMs: number | null = null;
  private sawPower = false;

  constructor(startMs: number) {
    this.windowStartS = Math.floor(startMs / 1000 / WINDOW_S) * WINDOW_S;
    this.coveredFromMs = startMs;
  }

  /**
   * After a restart: hold `watts` from `atMs` on, but count the hold limit
   * from when the charger really reported (`reportedAtMs`).
   */
  resume(atMs: number, watts: number, reportedAtMs: number): void {
    this.lastPowerW = Number.isFinite(watts) && watts > 0 ? watts : 0;
    this.lastPowerAtMs = atMs;
    this.sawPower = true;
    this.lastReportAtMs = reportedAtMs;
  }

  /** A charger `power` reading (W). Closed windows are returned. */
  power(atMs: number, watts: number): CarWindow[] {
    const closed = this.advance(atMs);
    this.integrateTo(atMs);
    this.lastPowerW = Number.isFinite(watts) && watts > 0 ? watts : 0;
    this.lastPowerAtMs = atMs;
    this.sawPower = true;
    this.lastReportAtMs = atMs;
    return closed;
  }

  /** A charger `energy` delta (Wh). */
  carEnergy(atMs: number, wh: number): CarWindow[] {
    const closed = this.advance(atMs);
    if (Number.isFinite(wh) && wh > 0) this.energyWh += wh;
    this.chargerReport(atMs);
    return closed;
  }

  /** Any other charger report: keeps the held power alive. */
  chargerReport(atMs: number): void {
    if (this.lastReportAtMs === null || atMs > this.lastReportAtMs) this.lastReportAtMs = atMs;
  }

  /** Close every window that ended at or before `atMs`. */
  advance(atMs: number): CarWindow[] {
    const closed: CarWindow[] = [];
    while ((this.windowStartS + WINDOW_S) * 1000 <= atMs) {
      const endMs = (this.windowStartS + WINDOW_S) * 1000;
      this.integrateTo(endMs);
      const m = this.take(WINDOW_S, endMs);
      if (m) closed.push(m);
      this.windowStartS += WINDOW_S;
      this.coveredFromMs = this.windowStartS * 1000;
    }
    return closed;
  }

  /** Session end: close what is due, then the partial window up to `atMs`. */
  finish(atMs: number): CarWindow[] {
    const closed = this.advance(atMs);
    this.integrateTo(atMs);
    const lengthS = Math.max(1, Math.round(atMs / 1000 - this.windowStartS));
    const m = this.take(lengthS, atMs);
    if (m) closed.push(m);
    this.lastPowerW = null;
    return closed;
  }

  private take(lengthS: number, endMs: number): CarWindow | null {
    const carWh = this.sawPower ? this.powerWh : this.energyWh;
    const window: CarWindow = {
      startS: this.windowStartS,
      lengthS,
      carWh,
      fromMs: this.coveredFromMs,
      toMs: endMs,
    };
    this.powerWh = 0;
    this.energyWh = 0;
    return carWh > 0 ? window : null;
  }

  /** Add the held power from the last integration point up to `toMs`. */
  private integrateTo(toMs: number): void {
    if (this.lastPowerW === null || this.lastPowerAtMs === null) return;
    const limit = (this.lastReportAtMs ?? this.lastPowerAtMs) + HOLD_LIMIT_MS;
    const until = Math.min(toMs, limit);
    if (until > this.lastPowerAtMs) {
      this.powerWh += (this.lastPowerW * (until - this.lastPowerAtMs)) / 3_600_000;
    }
    if (toMs > this.lastPowerAtMs) this.lastPowerAtMs = toMs;
  }
}

/** A window once priced: the car served last by the sun (P5). */
export interface WindowSettlement {
  carWh: number;
  gridHpWh: number;
  gridHcWh: number;
  /** Null when no tariff is configured. */
  costHpEur: number | null;
  costHcEur: number | null;
}

/**
 * Price one window. `grid = min(car, import)`; without a main meter or without
 * a grid reading in the window, everything is grid. `hcShare` is the share of
 * the window in off-peak hours, from the TariffClassifier.
 */
export function settleWindow(
  m: WindowMeasure,
  opts: { hasMainMeter: boolean; hcShare: number; prices: { hp: number; hc: number } | null },
): WindowSettlement {
  const imported = opts.hasMainMeter && m.importWh !== null ? m.importWh : m.carWh;
  const grid = Math.min(m.carWh, imported);
  const share = Math.min(1, Math.max(0, Number.isFinite(opts.hcShare) ? opts.hcShare : 0));
  const gridHcWh = grid * share;
  const gridHpWh = grid - gridHcWh;
  return {
    carWh: m.carWh,
    gridHpWh,
    gridHcWh,
    costHpEur: opts.prices ? (gridHpWh / 1000) * opts.prices.hp : null,
    costHcEur: opts.prices ? (gridHcWh / 1000) * opts.prices.hc : null,
  };
}
