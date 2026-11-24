/**
 * Spec 211 FR2 — `ctx.helpers.history`: read-only, bounded access to the
 * history Sowel already keeps, for recipes.
 *
 * A thin wrapper over `queryHistory`. It computes nothing new; it resolves
 * the alias strictly against what the core declared, aligns the window on
 * whole periods, and normalises every point to the start of its period
 * whatever bucket answered, so a recipe sees complete periods only, all
 * stamped the same way.
 */

import type { Logger } from "../../core/logger.js";
import type { InfluxClient } from "../../core/influx-client.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type {
  DataCategory,
  HistoryPoint,
  RecipeHistory,
  RecipeHistoryQuery,
  RecipeHistoryResult,
} from "../../shared/types.js";
import { getServerTz, parseFrom, queryHistory } from "../../history/history-query.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** FR2.5 — the furthest back a recipe reads (the raw bucket's retention). */
export const RECIPE_HISTORY_MAX_WINDOW_MS = 7 * DAY_MS;
/** FR2.7 — calls reaching Influx per rolling minute, per context. */
export const RECIPE_HISTORY_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

type Aggregation = "1h" | "1d";
/** How the core stamps and cuts a category's buckets (FR2.6, FR2.9). */
type Kind = "energy" | "rain" | "continuous";

function kindOf(category: DataCategory | undefined): Kind {
  if (category === "energy") return "energy";
  if (category === "rain") return "rain";
  return "continuous";
}

// ── Period boundaries ──────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at instant `ms`, in ms (positive east of UTC). */
function tzOffsetMs(ms: number, tz: string): number {
  const parts = formatterFor(tz).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The local calendar date (in `tz`) of instant `ms`, as UTC-midnight ms of that date. */
function localDateKey(ms: number, tz: string): number {
  const shifted = ms + tzOffsetMs(ms, tz);
  return Math.floor(shifted / DAY_MS) * DAY_MS;
}

/** The instant local midnight of the date `dateKey` (UTC-midnight ms) falls at, in `tz`. */
function localMidnight(dateKey: number, tz: string): number {
  let t = dateKey - tzOffsetMs(dateKey, tz);
  // The offset may differ at the guess and at the real midnight (DST day).
  const off = tzOffsetMs(t, tz);
  if (dateKey - off !== t) t = dateKey - off;
  return t;
}

interface Periods {
  floor(ms: number): number;
  ceil(ms: number): number;
  next(ms: number): number;
  /** Length of the period ending at the aligned boundary `ms`. */
  before(ms: number): number;
}

function fixedPeriods(len: number): Periods {
  return {
    floor: (ms) => Math.floor(ms / len) * len,
    ceil: (ms) => Math.ceil(ms / len) * len,
    next: (ms) => ms + len,
    before: () => len,
  };
}

/** FR2.5 — local days (rain): cut at local midnight, 23- or 25-hour days included. */
function localDayPeriods(tz: string): Periods {
  const floor = (ms: number) => localMidnight(localDateKey(ms, tz), tz);
  // In a zone whose DST change skips midnight itself (America/Santiago), the
  // computed midnight can fall back onto the previous date: step one more day
  // so a boundary always moves forward.
  const next = (ms: number) => {
    const key = localDateKey(ms, tz);
    const t = localMidnight(key + DAY_MS, tz);
    return t > ms ? t : localMidnight(key + 2 * DAY_MS, tz);
  };
  return {
    floor,
    ceil: (ms) => {
      const f = floor(ms);
      return f === ms ? ms : next(f);
    },
    next,
    before: (ms) => ms - localMidnight(localDateKey(ms, tz) - DAY_MS, tz),
  };
}

function periodsFor(aggregation: Aggregation, kind: Kind, tz: string): Periods {
  if (aggregation === "1h") return fixedPeriods(HOUR_MS);
  // FR2.5 — the core cuts rain days at local midnight, energy and continuous
  // measures at UTC midnight.
  return kind === "rain" ? localDayPeriods(tz) : fixedPeriods(DAY_MS);
}

/**
 * FR2.6 — how far back a stored stamp must move to sit at the start of its
 * period, for the bucket that answered.
 */
function stampsAtEnd(kind: Kind, source: "downsampled" | "raw"): boolean {
  if (kind === "rain") return false;
  if (kind === "energy") return source === "raw";
  return true;
}

// ── The helper ─────────────────────────────────────────────────────

export interface RecipeHistoryDeps {
  influxClient: InfluxClient;
  equipmentManager: EquipmentManager;
  logger: Logger;
  instanceId: string;
  /** IANA zone rain days are cut in. Defaults to the server's, as `queryHistory`. */
  timezone?: string;
  /**
   * False once the start this helper was built for is over (instance stopped
   * or restarted): a leftover closure then reads nothing, and a restart does
   * not add a second budget. Absent = always current (validation contexts).
   */
  isCurrent?: () => boolean;
}

type Prepared =
  | { done: true; result: RecipeHistoryResult }
  | {
      done: false;
      equipmentId: string;
      alias: string;
      aggregation: Aggregation;
      category: DataCategory | undefined;
      kind: Kind;
      periods: Periods;
      alignedFrom: number;
      alignedTo: number;
    };

/**
 * One helper per recipe context: its rate-limit timestamps and its
 * clamp-warning flag live in this closure and die with the context.
 */
export function createRecipeHistory(deps: RecipeHistoryDeps): RecipeHistory {
  const logger = deps.logger.child({ module: "recipe-history", instanceId: deps.instanceId });
  const tz = deps.timezone ?? getServerTz();
  const calls: number[] = [];
  let clampWarned = false;

  // Answered without Influx: nothing to read (FR2.3-FR2.5).
  const empty = (): RecipeHistoryResult => ({ points: [], ok: true });
  const failed = (): RecipeHistoryResult => ({ points: [], ok: false });

  function prepare(params: RecipeHistoryQuery): Prepared {
    const p = (params ?? {}) as Partial<RecipeHistoryQuery>;
    const { equipmentId, alias, aggregation } = p;

    // FR2.4 — external recipes are plain JS: refuse what the type would.
    if (aggregation !== "1h" && aggregation !== "1d") return { done: true, result: empty() };
    if (typeof equipmentId !== "string" || typeof alias !== "string") {
      return { done: true, result: empty() };
    }

    // FR2.3 — the alias must be one the core declared: a data binding, else a
    // computed data entry. Nothing else reaches Flux.
    const binding = deps.equipmentManager
      .getDataBindingsWithValues(equipmentId)
      .find((b) => b.alias === alias);
    let category: DataCategory | undefined;
    if (binding) {
      // FR2.4 — boolean / enum would be read raw (2000 points + carry-in).
      if (binding.type === "boolean" || binding.type === "enum") {
        return { done: true, result: empty() };
      }
      category = binding.category;
    } else {
      const computed = deps.equipmentManager
        .getComputedDataFor(equipmentId)
        .find((c) => c.alias === alias);
      if (!computed) return { done: true, result: empty() };
      category = computed.category;
    }
    const kind = kindOf(category);
    const periods = periodsFor(aggregation, kind, tz);

    // FR2.5 — the window.
    // A plain-JS recipe may pass `to: null`: read as "now", like an absent `to`.
    const to = p.to ?? undefined;
    if (typeof p.from !== "string" || (to !== undefined && typeof to !== "string")) {
      return { done: true, result: empty() };
    }
    const now = Date.now();
    let fromMs = parseFrom(p.from).getTime();
    let toMs = to === undefined ? now : parseFrom(to).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return { done: true, result: empty() };
    }
    toMs = Math.min(toMs, now);
    const earliest = now - RECIPE_HISTORY_MAX_WINDOW_MS;
    if (fromMs < earliest) {
      if (!clampWarned) {
        clampWarned = true;
        logger.warn(
          { equipmentId, alias, from: p.from },
          "Recipe history window clamped to the last 7 days",
        );
      }
      fromMs = earliest;
    }
    const alignedFrom = periods.ceil(fromMs);
    const alignedTo = periods.floor(toMs);
    if (alignedTo <= alignedFrom) return { done: true, result: empty() };

    // FR2.8 — not configured: nothing to ask. A stopped start asks nothing either.
    if (!deps.influxClient.isConnected()) return { done: true, result: failed() };
    if (deps.isCurrent && !deps.isCurrent()) return { done: true, result: failed() };

    return {
      done: false,
      equipmentId,
      alias,
      aggregation,
      category,
      kind,
      periods,
      alignedFrom,
      alignedTo,
    };
  }

  /** FR2.7 — counts only the calls that reach Influx. */
  function takeRateToken(): void {
    const now = Date.now();
    while (calls.length > 0 && calls[0] <= now - RATE_WINDOW_MS) calls.shift();
    if (calls.length >= RECIPE_HISTORY_RATE_LIMIT) throw new Error("history rate limit");
    calls.push(now);
  }

  /**
   * One `queryHistory` read of the aligned periods [fromMs, toMs), normalised
   * to period starts (FR2.6). `null` when the read hit an error (FR2.8).
   */
  async function read(
    q: Extract<Prepared, { done: false }>,
    fromMs: number,
    toMs: number,
    rawOnly: boolean,
  ): Promise<HistoryPoint[] | null> {
    let hadError = false;
    const { points: rows, source = "raw" } = await queryHistory(
      deps.influxClient,
      {
        equipmentId: q.equipmentId,
        alias: q.alias,
        from: new Date(fromMs).toISOString(),
        // FR2.5.4 — Flux's stop is exclusive and some stores stamp a period at
        // its end: one more period keeps the last complete one.
        to: new Date(q.periods.next(toMs)).toISOString(),
        aggregation: q.aggregation,
        dataType: "number",
        category: q.category,
        rawOnly,
        onError: () => {
          hadError = true;
        },
      },
      logger,
    );
    if (hadError) return null;

    const shift = stampsAtEnd(q.kind, source);
    const points: HistoryPoint[] = [];
    for (const row of rows) {
      const stored = Date.parse(row.time);
      if (!Number.isFinite(stored)) continue;
      const start = shift ? stored - q.periods.before(stored) : stored;
      // FR2.5.5 — complete periods only: the period after `toMs`, brought in
      // by the extra period, is stamped `toMs` and dropped here.
      if (start < fromMs || start >= toMs) continue;
      points.push({ ...row, time: new Date(start).toISOString() });
    }
    return points;
  }

  async function run(q: Extract<Prepared, { done: false }>): Promise<RecipeHistoryResult> {
    // FR2.5.6 — the last complete period is always read from the raw bucket.
    // The downsampling tasks write a closed period a few minutes after it ends
    // (and a rain day is summed from hourly rows, its last hour included), so
    // right after the hour — when an hourly consumer reads — a downsampled
    // bucket may lack it, or hold it partially. `queryHistory` only falls back
    // to raw when the downsampled bucket has nothing at all, and asking it for
    // the last period alone would not do: an end-stamped bucket answers that
    // window with the period before. The raw bucket keeps 7 days, which covers
    // it.
    const lastStart = q.alignedTo - q.periods.before(q.alignedTo);
    const head = lastStart > q.alignedFrom ? await read(q, q.alignedFrom, lastStart, false) : [];
    // FR2.8 — partial points after an error are dropped.
    if (!head) return failed();
    const tail = await read(q, lastStart, q.alignedTo, true);
    if (!tail) return failed();
    return { points: [...head, ...tail], ok: true };
  }

  return {
    async query(params: RecipeHistoryQuery): Promise<RecipeHistoryResult> {
      let prepared: Prepared;
      try {
        prepared = prepare(params);
      } catch (err) {
        logger.error({ err }, "Recipe history query failed");
        return failed();
      }
      if (prepared.done) return prepared.result;

      takeRateToken(); // the only throw a recipe ever sees

      try {
        return await run(prepared);
      } catch (err) {
        logger.error(
          { err, equipmentId: prepared.equipmentId, alias: prepared.alias },
          "Recipe history query failed",
        );
        return failed();
      }
    },
  };
}
