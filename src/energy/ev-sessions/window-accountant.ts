/**
 * Spec 191 — the energy of an open charge session, by 5-minute windows.
 *
 * Pure: no clock, no bus, no database. The tracker feeds it the charger's
 * power and energy and the main meter's live grid deltas, with their times,
 * and collects every window that closed.
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

/** What one window measured, before pricing. */
export interface WindowMeasure {
  /** Window start, epoch seconds. */
  startS: number;
  /** Window length actually covered, seconds (shorter for the last one). */
  lengthS: number;
  /** The car's draw (Wh). */
  carWh: number;
  /** Σ max(0, grid delta) over the window (Wh); null when the meter said nothing. */
  importWh: number | null;
}

export class WindowAccountant {
  private windowStartS: number;
  private powerWh = 0;
  private energyWh = 0;
  private importWh = 0;
  private gridTicks = 0;
  private lastPowerW: number | null = null;
  private lastPowerAtMs: number | null = null;
  private lastReportAtMs: number | null = null;
  private sawPower = false;

  constructor(startMs: number) {
    this.windowStartS = Math.floor(startMs / 1000 / WINDOW_S) * WINDOW_S;
  }

  /** A charger `power` reading (W). Closed windows are returned. */
  power(atMs: number, watts: number): WindowMeasure[] {
    const closed = this.advance(atMs);
    this.integrateTo(atMs);
    this.lastPowerW = Number.isFinite(watts) && watts > 0 ? watts : 0;
    this.lastPowerAtMs = atMs;
    this.sawPower = true;
    this.lastReportAtMs = atMs;
    return closed;
  }

  /** A charger `energy` delta (Wh). */
  carEnergy(atMs: number, wh: number): WindowMeasure[] {
    const closed = this.advance(atMs);
    if (Number.isFinite(wh) && wh > 0) this.energyWh += wh;
    this.chargerReport(atMs);
    return closed;
  }

  /** Any other charger report: keeps the held power alive. */
  chargerReport(atMs: number): void {
    if (this.lastReportAtMs === null || atMs > this.lastReportAtMs) this.lastReportAtMs = atMs;
  }

  /** A live main-meter delta (Wh, positive = imported). */
  grid(atMs: number, signedWh: number): WindowMeasure[] {
    const closed = this.advance(atMs);
    if (Number.isFinite(signedWh)) {
      this.importWh += Math.max(0, signedWh);
      this.gridTicks++;
    }
    return closed;
  }

  /** Close every window that ended at or before `atMs`. */
  advance(atMs: number): WindowMeasure[] {
    const closed: WindowMeasure[] = [];
    while ((this.windowStartS + WINDOW_S) * 1000 <= atMs) {
      const endMs = (this.windowStartS + WINDOW_S) * 1000;
      this.integrateTo(endMs);
      const m = this.take(WINDOW_S);
      if (m) closed.push(m);
      this.windowStartS += WINDOW_S;
    }
    return closed;
  }

  /** Session end: close what is due, then the partial window up to `atMs`. */
  finish(atMs: number): WindowMeasure[] {
    const closed = this.advance(atMs);
    this.integrateTo(atMs);
    const lengthS = Math.max(1, Math.round(atMs / 1000 - this.windowStartS));
    const m = this.take(lengthS);
    if (m) closed.push(m);
    this.lastPowerW = null;
    return closed;
  }

  private take(lengthS: number): WindowMeasure | null {
    const carWh = this.sawPower ? this.powerWh : this.energyWh;
    const measure: WindowMeasure = {
      startS: this.windowStartS,
      lengthS,
      carWh,
      importWh: this.gridTicks > 0 ? this.importWh : null,
    };
    this.powerWh = 0;
    this.energyWh = 0;
    this.importWh = 0;
    this.gridTicks = 0;
    return carWh > 0 ? measure : null;
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
