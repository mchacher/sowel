/**
 * Spec 211 FR2 — `ctx.helpers.history`: read-only, bounded access to the
 * history Sowel already keeps, for recipes.
 *
 * A thin wrapper over `queryHistory`. It resolves the alias strictly against
 * what the core declared, aligns the window on whole periods, reads the raw
 * bucket (it keeps 7 days, the longest window a recipe may ask for, and holds
 * the last period before the downsampling tasks copy it), and stamps every
 * point at the start of its period.
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
import { parseFrom, queryHistory } from "../../history/history-query.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** FR2.5 — the furthest back a recipe reads (the raw bucket's retention). */
export const RECIPE_HISTORY_MAX_WINDOW_MS = 7 * DAY_MS;
/** FR2.7 — calls reaching Influx per rolling minute, per context. */
export const RECIPE_HISTORY_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

type Aggregation = "1h" | "1d";

/**
 * FR2.5 — periods as the raw-bucket Flux cuts them: rain in the server's
 * local time (`aggregateWindow` with `location`), everything else in UTC.
 * Local time comes from `process.env.TZ`, as everywhere in the core (spec 061).
 */
function floorPeriod(ms: number, aggregation: Aggregation, local: boolean): number {
  const d = new Date(ms);
  if (aggregation === "1h") {
    if (local) d.setMinutes(0, 0, 0);
    else d.setUTCMinutes(0, 0, 0);
  } else if (local) d.setHours(0, 0, 0, 0);
  else d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function ceilPeriod(ms: number, aggregation: Aggregation, local: boolean): number {
  const f = floorPeriod(ms, aggregation, local);
  if (f === ms) return ms;
  if (aggregation === "1h") return f + HOUR_MS;
  // A local day lasts 23 or 25 hours on a DST change: step past it, then floor.
  return floorPeriod(f + DAY_MS + 2 * HOUR_MS, aggregation, local);
}

export interface RecipeHistoryDeps {
  influxClient: InfluxClient;
  equipmentManager: EquipmentManager;
  logger: Logger;
  instanceId: string;
  /**
   * False once the start this helper was built for is over (instance stopped
   * or restarted): a leftover closure then reads nothing, and a restart does
   * not add a second budget. Absent = always current (validation contexts).
   */
  isCurrent?: () => boolean;
}

/**
 * One helper per recipe context: its rate-limit timestamps and its warning
 * flags live in this closure and die with the context.
 */
export function createRecipeHistory(deps: RecipeHistoryDeps): RecipeHistory {
  const logger = deps.logger.child({ module: "recipe-history", instanceId: deps.instanceId });
  const calls: number[] = [];
  let clampWarned = false;
  let limitWarned = false;

  const empty = (): RecipeHistoryResult => ({ points: [], ok: true });
  const failed = (): RecipeHistoryResult => ({ points: [], ok: false });

  /** FR2.7 — counts only the calls that reach Influx. */
  function takeRateToken(): boolean {
    const now = Date.now();
    while (calls.length > 0 && calls[0] <= now - RATE_WINDOW_MS) calls.shift();
    if (calls.length >= RECIPE_HISTORY_RATE_LIMIT) {
      if (!limitWarned) {
        limitWarned = true;
        logger.warn("Recipe history rate limit reached");
      }
      return false;
    }
    calls.push(now);
    return true;
  }

  async function query(params: RecipeHistoryQuery): Promise<RecipeHistoryResult> {
    // FR2.4 — external recipes are plain JS: refuse what the type would.
    const p = (params ?? {}) as Partial<RecipeHistoryQuery>;
    const { equipmentId, alias, aggregation } = p;
    const to = p.to ?? undefined; // `to: null` reads as "now", like an absent `to`
    if (aggregation !== "1h" && aggregation !== "1d") return empty();
    if (typeof equipmentId !== "string" || typeof alias !== "string") return empty();
    if (typeof p.from !== "string" || (to !== undefined && typeof to !== "string")) return empty();

    // FR2.3 — the alias must be one the core declared: a data binding, else a
    // computed data entry. Nothing else reaches Flux.
    let category: DataCategory | undefined;
    const binding = deps.equipmentManager
      .getDataBindingsWithValues(equipmentId)
      .find((b) => b.alias === alias);
    if (binding) {
      // FR2.4 — boolean / enum would be read raw (2000 points + carry-in).
      if (binding.type === "boolean" || binding.type === "enum") return empty();
      category = binding.category;
    } else {
      const computed = deps.equipmentManager
        .getComputedDataFor(equipmentId)
        .find((c) => c.alias === alias);
      if (!computed) return empty();
      category = computed.category;
    }
    const local = category === "rain";

    // FR2.5 — the window: complete periods within the last 7 days.
    const now = Date.now();
    let fromMs = parseFrom(p.from).getTime();
    const toMs = Math.min(to === undefined ? now : parseFrom(to).getTime(), now);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return empty();
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
    const alignedFrom = ceilPeriod(fromMs, aggregation, local);
    const alignedTo = floorPeriod(toMs, aggregation, local);
    if (alignedTo <= alignedFrom) return empty();

    // FR2.8 — not configured: nothing to ask. A stopped start asks nothing either.
    if (!deps.influxClient.isConnected()) return failed();
    if (deps.isCurrent && !deps.isCurrent()) return failed();
    if (!takeRateToken()) return failed();

    let hadError = false;
    const { points: rows } = await queryHistory(
      deps.influxClient,
      {
        equipmentId,
        alias,
        from: new Date(alignedFrom).toISOString(),
        to: new Date(alignedTo).toISOString(),
        aggregation,
        dataType: "number",
        category,
        rawOnly: true,
        onError: () => {
          hadError = true;
        },
      },
      logger,
    );
    // FR2.8 — partial points after an error are dropped.
    if (hadError) return failed();

    // FR2.6 — the raw-bucket Flux stamps rain at the start of its period and
    // everything else at its end (UTC periods, so a fixed length back).
    const len = aggregation === "1h" ? HOUR_MS : DAY_MS;
    const points: HistoryPoint[] = [];
    for (const row of rows) {
      const stored = Date.parse(row.time);
      if (!Number.isFinite(stored)) continue;
      const start = local ? stored : stored - len;
      if (start < alignedFrom || start >= alignedTo) continue;
      points.push({ ...row, time: new Date(start).toISOString() });
    }
    return { points, ok: true };
  }

  return {
    async query(params: RecipeHistoryQuery): Promise<RecipeHistoryResult> {
      // Never throws: a rejection a recipe leaves unhandled would stop the process.
      try {
        return await query(params);
      } catch (err) {
        logger.error({ err }, "Recipe history query failed");
        return failed();
      }
    },
  };
}
