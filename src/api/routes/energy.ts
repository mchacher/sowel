import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { TariffClassifier } from "../../energy/tariff-classifier.js";
import { blendedRate, computeCost } from "../../energy/cost-calculator.js";
import type { InfluxClient } from "../../core/influx-client.js";
import type {
  EnergyPoint,
  EnergyTotals,
  EnergyHistoryResponse,
  EnergyStatus,
  TariffConfig,
  TariffPrices,
  EnergyByUsageResponse,
  SubmeterSeries,
  EnergyByUsagePoint,
} from "../../shared/types.js";

interface EnergyDeps {
  equipmentManager: EquipmentManager;
  influxClient: InfluxClient;
  settingsManager: SettingsManager;
  tariffClassifier: TariffClassifier;
  logger: Logger;
}

export function registerEnergyRoutes(app: FastifyInstance, deps: EnergyDeps): void {
  const {
    equipmentManager,
    influxClient,
    settingsManager,
    tariffClassifier,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "energy-api" });

  // Spec 119 — surface the resolved server TZ once at boot so an
  // operator can catch a misconfigured `docker-compose.yml` (a wrong
  // TZ silently shifts every week / month / year bucket boundary by
  // ±1 day).  The TZ is reused by every Flux `aggregateWindow(location:)`
  // call across the four query helpers below.
  logger.info({ tz: getServerTz() }, "energy routes: aggregation TZ resolved");

  // ============================================================
  // GET /api/v1/energy/status
  // ============================================================
  app.get("/api/v1/energy/status", async (): Promise<EnergyStatus> => {
    const eqId = findEnergyEquipmentId(equipmentManager);
    const prodId = findProductionEquipmentId(equipmentManager);
    // Spec 123: a tariff is only "configured" (cost UI enabled) when at
    // least one price is set. A schedule with prices 0/0 leaves cost
    // valuation pointless, so the UnitToggle must stay disabled.
    const tariff = tariffClassifier.getConfig();
    const tariffConfigured =
      tariff !== null && ((tariff.prices.hp ?? 0) > 0 || (tariff.prices.hc ?? 0) > 0);
    return {
      available: eqId !== null,
      hasProduction: prodId !== null,
      sources: eqId ? ["legrand"] : [],
      lastDataAt: null, // TODO: query InfluxDB for latest point
      tariffConfigured,
    };
  });

  // ============================================================
  // GET /api/v1/energy/history
  // ============================================================
  app.get<{
    Querystring: { period?: string; date?: string };
  }>("/api/v1/energy/history", async (request, reply) => {
    const period = request.query.period ?? "day";
    const dateStr = request.query.date ?? new Date().toISOString().slice(0, 10);

    if (!["day", "week", "month", "year"].includes(period)) {
      return reply.status(400).send({ error: "Invalid period. Use: day, week, month, year" });
    }

    const equipmentId = findEnergyEquipmentId(equipmentManager);
    if (!equipmentId) {
      return reply.status(404).send({ error: "No energy equipment configured" });
    }

    const productionEquipmentId = findProductionEquipmentId(equipmentManager);

    const config = influxClient.getConfig();
    const client = influxClient.getClient();
    if (!config || !client) {
      return reply.status(503).send({ error: "InfluxDB not configured" });
    }

    const { from, to, resolution, bucket } = computeRange(period, dateStr, config.bucket);

    try {
      // Query HP/HC points and legacy (total energy) points, then merge.
      // For timestamps with HP/HC data, use those. For timestamps with only
      // legacy data (pre-migration or written before tariff config), use legacy as HP.
      const buckets = [bucket];
      if (period === "day" && !bucket.includes("-energy-")) {
        buckets.push(`${config.bucket}-energy-hourly`);
      }

      let hpHcPoints: Array<{ time: string; hp: number; hc: number }> = [];
      let legacyPoints: Array<{ time: string; hp: number; hc: number }> = [];

      for (const b of buckets) {
        if (hpHcPoints.length === 0) {
          hpHcPoints = await queryEnergyHpHcPoints(
            client,
            config.org,
            b,
            equipmentId,
            from,
            to,
            resolution,
          );
        }
        if (legacyPoints.length === 0) {
          legacyPoints = await queryEnergyLegacyPoints(
            client,
            config.org,
            b,
            equipmentId,
            from,
            to,
            resolution,
          );
        }
        if (hpHcPoints.length > 0 || legacyPoints.length > 0) break;
      }

      // Merge: HP/HC points take priority; fill gaps with legacy
      const hpHcByTime = new Map(hpHcPoints.map((p) => [p.time, p]));
      const consumptionPoints: Array<{ time: string; hp: number; hc: number }> = [];
      const allConsoTimes = new Set([
        ...hpHcPoints.map((p) => p.time),
        ...legacyPoints.map((p) => p.time),
      ]);
      for (const time of allConsoTimes) {
        const hpHc = hpHcByTime.get(time);
        if (hpHc) {
          consumptionPoints.push(hpHc);
        } else {
          const legacy = legacyPoints.find((p) => p.time === time);
          if (legacy) consumptionPoints.push(legacy);
        }
      }
      consumptionPoints.sort((a, b) => a.time.localeCompare(b.time));

      // Query production data if production Equipment exists.
      // Same bucket-fallback logic as the consumption side: when period=day
      // the primary bucket is raw (7d retention), but a backfill — or simply
      // the live downsample — may have written the data only to
      // `-energy-hourly`. Fall back to it when the primary bucket is empty.
      const prodMap = new Map<string, { prod: number; autoconso: number; injection: number }>();
      if (productionEquipmentId) {
        for (const b of buckets) {
          const prodPoints = await queryProductionPoints(
            client,
            config.org,
            b,
            productionEquipmentId,
            from,
            to,
            resolution,
          );
          for (const p of prodPoints) {
            prodMap.set(p.time, p);
          }
          if (prodMap.size > 0) break;
        }
      }

      // Spec 119 — always return N buckets for the period.  Walk the
      // expected bucket times in local TZ and zero-fill any bucket
      // that neither consumption nor production data filled.  This
      // gives consumers (web UI, sowel-energy-display firmware) a
      // fixed-length array to iterate without gap-handling code.
      // Spec 123 — value each bucket in € at read time using the
      // current TariffPrices. Per-point cost matches the raw bucket
      // consumption (chart bar tooltips); totals' cost uses the
      // grid-side hp/hc (autoconso-subtracted) to match the summary
      // card "grid consumption" semantics.
      const prices: TariffPrices = tariffClassifier.getConfig()?.prices ?? { hp: 0, hc: 0 };
      const consoByTime = new Map(consumptionPoints.map((p) => [p.time, p]));
      const points: EnergyPoint[] = [];
      for (const time of expectedBucketTimes(from, to, resolution)) {
        const conso = consoByTime.get(time);
        const hp = conso?.hp ?? 0;
        const hc = conso?.hc ?? 0;
        const prodData = prodMap.get(time);
        const prod = prodData?.prod ?? 0;
        const autoconso = prodData?.autoconso ?? 0;
        const injection = prodData?.injection ?? 0;
        const cost = computeCost(hp, hc, prices);
        points.push({ time, hp, hc, prod, autoconso, injection, ...cost });
      }

      const totals = computeTotals(points, prices);

      const response: EnergyHistoryResponse = {
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        resolution,
        points,
        totals,
      };

      return response;
    } catch (err) {
      logger.error({ err, period, dateStr }, "Energy history query failed");
      return reply.status(500).send({ error: "Failed to query energy data" });
    }
  });

  // ============================================================
  // GET /api/v1/energy/by-usage
  // ============================================================
  app.get<{
    Querystring: { period?: string; date?: string };
  }>("/api/v1/energy/by-usage", async (request, reply) => {
    const period = request.query.period ?? "day";
    const dateStr = request.query.date ?? new Date().toISOString().slice(0, 10);

    if (!["day", "week", "month", "year"].includes(period)) {
      return reply.status(400).send({ error: "Invalid period. Use: day, week, month, year" });
    }

    const config = influxClient.getConfig();
    const client = influxClient.getClient();
    if (!config || !client) {
      return reply.status(503).send({ error: "InfluxDB not configured" });
    }

    const submeterEquipments = equipmentManager.getAll().filter((eq) => eq.type === "energy_meter");
    const mainEquipmentId = findEnergyEquipmentId(equipmentManager);

    const { from, to, resolution, bucket } = computeRange(period, dateStr, config.bucket);

    try {
      const buckets = [bucket];
      if (period === "day" && !bucket.includes("-energy-")) {
        buckets.push(`${config.bucket}-energy-hourly`);
      }

      // Spec 119 — every series in the response is N buckets long
      // (fixed per period).  Compute the canonical bucket times once
      // up front; each submeter and the "other" residual zero-fill
      // against this list.
      const bucketTimes = expectedBucketTimes(from, to, resolution);

      // Per-submeter series
      const submeters: SubmeterSeries[] = [];
      const totalsByEquipment: Record<string, number> = {};
      const sumPerTime = new Map<string, number>();

      const sortedSubmeters = [...submeterEquipments].sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i < sortedSubmeters.length; i++) {
        const eq = sortedSubmeters[i];
        let rawPoints: EnergyByUsagePoint[] = [];
        for (const b of buckets) {
          rawPoints = await querySubmeterPoints(client, config.org, b, eq.id, from, to, resolution);
          if (rawPoints.length > 0) break;
        }
        const byTime = new Map(rawPoints.map((p) => [p.time, p.wh] as const));
        // Build the always-N series.
        const points: EnergyByUsagePoint[] = bucketTimes.map((time) => ({
          time,
          wh: byTime.get(time) ?? 0,
        }));
        const total = points.reduce((acc, p) => acc + p.wh, 0);
        totalsByEquipment[eq.id] = total;
        for (const p of points) {
          sumPerTime.set(p.time, (sumPerTime.get(p.time) ?? 0) + p.wh);
        }
        submeters.push({
          id: eq.id,
          name: eq.name,
          color: pickPaletteColor(i),
          points,
          cost: 0, // Spec 123 — filled below once blended rate is known.
        });
      }

      // "Other" residual = main meter consumption per time - Σ submeters per time, clamped ≥ 0.
      // Built against the canonical bucket list so the array length matches the submeters'.
      const otherPoints: EnergyByUsagePoint[] = [];
      let otherTotal = 0;
      let mainTotal = 0;

      if (mainEquipmentId) {
        let mainPoints: EnergyByUsagePoint[] = [];
        for (const b of buckets) {
          mainPoints = await queryMainConsumptionPoints(
            client,
            config.org,
            b,
            mainEquipmentId,
            from,
            to,
            resolution,
          );
          if (mainPoints.length > 0) break;
        }
        const mainByTime = new Map(mainPoints.map((p) => [p.time, p.wh] as const));
        for (const time of bucketTimes) {
          const wh = mainByTime.get(time) ?? 0;
          mainTotal += wh;
          const subs = sumPerTime.get(time) ?? 0;
          const other = Math.max(0, wh - subs);
          otherPoints.push({ time, wh: other });
          otherTotal += other;
        }
      }

      const totalSubmeters = Object.values(totalsByEquipment).reduce((a, b) => a + b, 0);
      const total = mainEquipmentId ? mainTotal : totalSubmeters;

      // Spec 123 — derive a period-blended €/kWh from the main meter's
      // HP/HC split for the same window, then value each submeter +
      // "other" with that single rate. Submeters store only `energy`
      // (no HP/HC channel), so a per-bucket split would require N×2
      // extra Influx queries per submeter; the blended period rate
      // gets us a single consistent number at the cost of slight
      // attribution skew for equipments running exclusively in HC.
      const prices: TariffPrices = tariffClassifier.getConfig()?.prices ?? { hp: 0, hc: 0 };
      const costByEquipment: Record<string, number> = {};
      let otherCost = 0;
      let totalCost = 0;
      if (mainEquipmentId) {
        const consumptionTotalsWh = await sumConsumptionHpHc(
          client,
          config.org,
          buckets,
          mainEquipmentId,
          from,
          to,
          resolution,
        );
        const { cost_total } = computeCost(consumptionTotalsWh.hp, consumptionTotalsWh.hc, prices);
        const rate = blendedRate(consumptionTotalsWh.hp + consumptionTotalsWh.hc, cost_total);
        if (rate > 0) {
          for (const eq of submeters) {
            const eqCost = round4((totalsByEquipment[eq.id] / 1000) * rate);
            costByEquipment[eq.id] = eqCost;
            eq.cost = eqCost;
          }
          otherCost = round4((otherTotal / 1000) * rate);
          totalCost = round4((total / 1000) * rate);
          logger.debug(
            { rate, period, date: dateStr, mainEquipmentId },
            "Computed by-usage blended €/kWh",
          );
        } else {
          // Tariff missing or zero — fall through with empty cost maps.
          for (const eq of submeters) {
            costByEquipment[eq.id] = 0;
            eq.cost = 0;
          }
        }
      } else {
        // No main meter → no aggregate HP/HC available → no cost.
        for (const eq of submeters) {
          costByEquipment[eq.id] = 0;
          eq.cost = 0;
        }
      }

      const response: EnergyByUsageResponse = {
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        resolution,
        submeters,
        other: { points: otherPoints },
        totals: {
          byEquipment: totalsByEquipment,
          other: otherTotal,
          total,
          costByEquipment,
          otherCost,
          totalCost,
        },
      };

      return response;
    } catch (err) {
      logger.error({ err, period, dateStr }, "Energy by-usage query failed");
      return reply.status(500).send({ error: "Failed to query energy by-usage data" });
    }
  });

  // ============================================================
  // GET /api/v1/settings/energy/tariff (admin only — carries prices)
  // ============================================================
  app.get("/api/v1/settings/energy/tariff", async (request, reply) => {
    // Issue #381: the spec 131 role gate only covers mutating methods, so this
    // GET needs its own check — same as GET /api/v1/settings. Recipes read the
    // schedule (without prices) through ctx.helpers.getTariff() instead.
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const config = tariffClassifier.getConfig();
    return config ?? { schedules: [], prices: { hp: 0, hc: 0 } };
  });

  // ============================================================
  // PUT /api/v1/settings/energy/tariff
  // ============================================================
  app.put<{ Body: TariffConfig }>("/api/v1/settings/energy/tariff", async (request, reply) => {
    const config = request.body;

    // Validate structure
    if (!config || !Array.isArray(config.schedules) || !config.prices) {
      return reply
        .status(400)
        .send({ error: "Invalid tariff config: missing schedules or prices" });
    }

    // Validate prices
    if (typeof config.prices.hp !== "number" || typeof config.prices.hc !== "number") {
      return reply.status(400).send({ error: "Invalid prices: hp and hc must be numbers" });
    }

    // Validate schedules
    for (const schedule of config.schedules) {
      if (!Array.isArray(schedule.days) || !Array.isArray(schedule.slots)) {
        return reply.status(400).send({ error: "Invalid schedule: missing days or slots" });
      }
      for (const day of schedule.days) {
        if (typeof day !== "number" || day < 0 || day > 6) {
          return reply.status(400).send({ error: "Invalid day: must be 0-6" });
        }
      }
      for (const slot of schedule.slots) {
        if (!slot.start || !slot.end || !["hp", "hc"].includes(slot.tariff)) {
          return reply
            .status(400)
            .send({ error: "Invalid slot: must have start, end, and tariff (hp/hc)" });
        }
      }
    }

    settingsManager.set("energy.tariff", JSON.stringify(config));
    logger.info("Tariff configuration updated");
    return { ok: true };
  });
}

// ============================================================
// Helpers
// ============================================================

function findEnergyEquipmentId(equipmentManager: EquipmentManager): string | null {
  const equipments = equipmentManager.getAll();
  const meter = equipments.find((eq) => eq.type === "main_energy_meter");
  return meter?.id ?? null;
}

function findProductionEquipmentId(equipmentManager: EquipmentManager): string | null {
  const equipments = equipmentManager.getAll();
  const meter = equipments.find((eq) => eq.type === "energy_production_meter");
  return meter?.id ?? null;
}

// Spec 119 — resolution literal extended to include "1mo" for the
// yearly bucket.  The same literal is exposed on
// `EnergyHistoryResponse.resolution`; keep the two in sync.
type Resolution = "5min" | "1h" | "1d" | "1mo";

// Spec 119 — Influx aggregateWindow `every` string per resolution.
const EVERY_BY_RESOLUTION: Record<Resolution, string> = {
  "5min": "5m",
  "1h": "1h",
  "1d": "1d",
  "1mo": "1mo",
};

/**
 * Spec 119 — server timezone used by Flux `aggregateWindow(location:)`
 * to align week / month / year buckets on the local midnight (and the
 * 1st of the local month / year), not UTC.  Reads `process.env.TZ`
 * with the docker-compose default `"Europe/Paris"` as the fallback.
 */
function getServerTz(): string {
  return process.env.TZ ?? "Europe/Paris";
}

/**
 * Spec 119 — walk `[from, to)` by `resolution` steps in the server's
 * local TZ and return each bucket-start as a UTC ISO string.  Used
 * by the route handlers to produce a fixed N-points response: any
 * bucket Influx did not return a row for is zero-filled.
 *
 * For `"5min"` / `"1h"` the walk is a fixed millis bump.  For
 * `"1d"` and `"1mo"` it goes through `setDate` / `setMonth`, which
 * keep the same local time across DST switches and clamp end-of-month
 * correctly (Jan 31 + 1 month → Feb 28/29).
 */
function expectedBucketTimes(from: Date, to: Date, resolution: Resolution): string[] {
  const times: string[] = [];
  let cursor = new Date(from);
  while (cursor < to) {
    times.push(cursor.toISOString());
    if (resolution === "5min") {
      cursor = new Date(cursor.getTime() + 5 * 60 * 1000);
    } else if (resolution === "1h") {
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    } else if (resolution === "1d") {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      cursor = next;
    } else {
      // "1mo"
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      cursor = next;
    }
  }
  return times;
}

function computeRange(
  period: string,
  dateStr: string,
  baseBucket: string,
): { from: Date; to: Date; resolution: Resolution; bucket: string } {
  const date = new Date(dateStr + "T00:00:00");

  switch (period) {
    case "day": {
      const from = new Date(date);
      const to = new Date(date);
      to.setDate(to.getDate() + 1);
      const ageMs = Date.now() - from.getTime();
      const isRecent = ageMs < 6 * 24 * 60 * 60 * 1000;
      return {
        from,
        to,
        resolution: "1h",
        bucket: isRecent ? baseBucket : `${baseBucket}-energy-hourly`,
      };
    }
    case "week": {
      const from = new Date(date);
      const dayOfWeek = from.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      from.setDate(from.getDate() + mondayOffset);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      // Spec 119 — daily resolution so the response is 7 buckets,
      // not 168 hourly points.  Flux aggregates the hourly bucket up
      // to 1 day at query time.
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-hourly` };
    }
    case "month": {
      const from = new Date(date.getFullYear(), date.getMonth(), 1);
      const to = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-daily` };
    }
    case "year": {
      const from = new Date(date.getFullYear(), 0, 1);
      const to = new Date(date.getFullYear() + 1, 0, 1);
      // Spec 119 — monthly resolution so the response is 12 buckets,
      // not ~365 daily points.
      return { from, to, resolution: "1mo", bucket: `${baseBucket}-energy-daily` };
    }
    default: {
      const from = new Date(date);
      const to = new Date(date);
      to.setDate(to.getDate() + 1);
      return { from, to, resolution: "5min", bucket: baseBucket };
    }
  }
}

/**
 * Query energy_hp and energy_hc points from InfluxDB, merge by timestamp.
 *
 * Spec 119 — always passes through `aggregateWindow(every: $resolution,
 * location: $tz)`, so bucket boundaries align with the server's local
 * TZ (week starts Monday 00:00 local, month on the 1st local 00:00,
 * year on Jan 1st local 00:00).  Empty buckets are NOT preserved here —
 * the route handler zero-fills them based on `expectedBucketTimes()`.
 */
async function queryEnergyHpHcPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<Array<{ time: string; hp: number; hc: number }>> {
  const queryApi = client.getQueryApi(org);
  const every = EVERY_BY_RESOLUTION[resolution];
  const tz = getServerTz();

  // Query both energy_hp and energy_hc in a single Flux query using alias filter
  const aliasFilter = `r.alias == "energy_hp" or r.alias == "energy_hc"`;
  const flux = `import "timezone"
from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(
       every: ${every},
       fn: sum,
       createEmpty: false,
       timeSrc: "_start",
       location: timezone.location(name: "${tz}"),
     )
  |> sort(columns: ["_time"])`;

  // Collect HP and HC values indexed by timestamp
  const hpMap = new Map<string, number>();
  const hcMap = new Map<string, number>();

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number; alias: string };
    if (row._value == null) continue;
    // Spec 119 — normalise the timestamp so it matches the canonical
    // ".000Z" form returned by `expectedBucketTimes()` (Date.toISOString)
    // regardless of how Influx formats `_time` in its raw response.
    const time = new Date(row._time).toISOString();
    if (row.alias === "energy_hp") {
      hpMap.set(time, (hpMap.get(time) ?? 0) + row._value);
    } else if (row.alias === "energy_hc") {
      hcMap.set(time, (hcMap.get(time) ?? 0) + row._value);
    }
  }

  // Merge into point array
  const allTimes = new Set([...hpMap.keys(), ...hcMap.keys()]);
  const points: Array<{ time: string; hp: number; hc: number }> = [];
  for (const time of allTimes) {
    const hp = hpMap.get(time) ?? 0;
    const hc = hcMap.get(time) ?? 0;
    if (hp + hc > 0) {
      points.push({ time, hp, hc });
    }
  }

  points.sort((a, b) => a.time.localeCompare(b.time));
  return points;
}

/**
 * Fallback: query legacy `energy` alias (pre-HP/HC migration).
 * Returns all consumption as HP.
 */
async function queryEnergyLegacyPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<Array<{ time: string; hp: number; hc: number }>> {
  const queryApi = client.getQueryApi(org);
  const every = EVERY_BY_RESOLUTION[resolution];
  const tz = getServerTz();

  const flux = `import "timezone"
from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(
       every: ${every},
       fn: sum,
       createEmpty: false,
       timeSrc: "_start",
       location: timezone.location(name: "${tz}"),
     )
  |> sort(columns: ["_time"])`;

  const points: Array<{ time: string; hp: number; hc: number }> = [];
  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value != null && row._value > 0) {
      points.push({ time: new Date(row._time).toISOString(), hp: row._value, hc: 0 });
    }
  }

  return points;
}

/**
 * Spec 123 — sum HP/HC consumption over a window using the same
 * bucket-fallback strategy as /energy/history. Used by /energy/by-usage
 * to derive a blended period €/kWh without re-implementing the merge.
 */
async function sumConsumptionHpHc(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  buckets: string[],
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<{ hp: number; hc: number }> {
  let hpHcPoints: Array<{ time: string; hp: number; hc: number }> = [];
  let legacyPoints: Array<{ time: string; hp: number; hc: number }> = [];
  for (const b of buckets) {
    if (hpHcPoints.length === 0) {
      hpHcPoints = await queryEnergyHpHcPoints(client, org, b, equipmentId, from, to, resolution);
    }
    if (legacyPoints.length === 0) {
      legacyPoints = await queryEnergyLegacyPoints(
        client,
        org,
        b,
        equipmentId,
        from,
        to,
        resolution,
      );
    }
    if (hpHcPoints.length > 0 || legacyPoints.length > 0) break;
  }
  const hpHcByTime = new Map(hpHcPoints.map((p) => [p.time, p]));
  let hp = 0;
  let hc = 0;
  const allTimes = new Set([...hpHcPoints.map((p) => p.time), ...legacyPoints.map((p) => p.time)]);
  for (const time of allTimes) {
    const p = hpHcByTime.get(time) ?? legacyPoints.find((lp) => lp.time === time);
    if (p) {
      hp += p.hp;
      hc += p.hc;
    }
  }
  return { hp, hc };
}

/**
 * Query production energy points from InfluxDB.
 * Production Equipment stores 3 aliases: "energy" (total), "autoconso", "injection".
 */
async function queryProductionPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<Array<{ time: string; prod: number; autoconso: number; injection: number }>> {
  const queryApi = client.getQueryApi(org);
  const every = EVERY_BY_RESOLUTION[resolution];
  const tz = getServerTz();

  const aliasFilter = `r.alias == "energy" or r.alias == "autoconso" or r.alias == "injection"`;
  const flux = `import "timezone"
from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(
       every: ${every},
       fn: sum,
       createEmpty: false,
       timeSrc: "_start",
       location: timezone.location(name: "${tz}"),
     )
  |> sort(columns: ["_time"])`;

  const prodMap = new Map<string, number>();
  const autoMap = new Map<string, number>();
  const injMap = new Map<string, number>();

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number; alias: string };
    if (row._value == null) continue;
    const time = new Date(row._time).toISOString();
    if (row.alias === "energy") {
      prodMap.set(time, (prodMap.get(time) ?? 0) + row._value);
    } else if (row.alias === "autoconso") {
      autoMap.set(time, (autoMap.get(time) ?? 0) + row._value);
    } else if (row.alias === "injection") {
      injMap.set(time, (injMap.get(time) ?? 0) + row._value);
    }
  }

  const allTimes = new Set([...prodMap.keys(), ...autoMap.keys(), ...injMap.keys()]);
  const points: Array<{ time: string; prod: number; autoconso: number; injection: number }> = [];
  for (const time of allTimes) {
    const prod = prodMap.get(time) ?? 0;
    const autoconso = autoMap.get(time) ?? 0;
    const injection = injMap.get(time) ?? 0;
    if (prod > 0 || autoconso > 0 || injection > 0) {
      points.push({ time, prod, autoconso, injection });
    }
  }

  points.sort((a, b) => a.time.localeCompare(b.time));
  return points;
}

/**
 * Submeter points: alias=energy attached to an `energy_meter` equipment.
 * Same shape as the main meter's legacy energy series.
 */
async function querySubmeterPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<EnergyByUsagePoint[]> {
  const queryApi = client.getQueryApi(org);
  const every = EVERY_BY_RESOLUTION[resolution];
  const tz = getServerTz();

  const flux = `import "timezone"
from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(
       every: ${every},
       fn: sum,
       createEmpty: false,
       timeSrc: "_start",
       location: timezone.location(name: "${tz}"),
     )
  |> sort(columns: ["_time"])`;

  const sums = new Map<string, number>();
  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value == null) continue;
    const time = new Date(row._time).toISOString();
    sums.set(time, (sums.get(time) ?? 0) + row._value);
  }
  return [...sums.entries()]
    .filter(([, wh]) => wh > 0)
    .map(([time, wh]) => ({ time, wh }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Main-meter consumption per time bucket, summed across HP/HC + legacy
 * energy alias. Used as the "total" baseline from which submeters are
 * subtracted to compute the "Other" residual.
 */
async function queryMainConsumptionPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  resolution: Resolution,
): Promise<EnergyByUsagePoint[]> {
  const queryApi = client.getQueryApi(org);
  const every = EVERY_BY_RESOLUTION[resolution];
  const tz = getServerTz();
  const aliasFilter = `r.alias == "energy_hp" or r.alias == "energy_hc" or r.alias == "energy"`;

  const flux = `import "timezone"
from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(
       every: ${every},
       fn: sum,
       createEmpty: false,
       timeSrc: "_start",
       location: timezone.location(name: "${tz}"),
     )
  |> sort(columns: ["_time"])`;

  // Sum HP+HC at each timestamp (legacy "energy" rows are already the total).
  // De-dupe: if both HP/HC and legacy exist for the same time, prefer HP+HC.
  const hpHcByTime = new Map<string, number>();
  const legacyByTime = new Map<string, number>();
  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number; alias: string };
    if (row._value == null) continue;
    const time = new Date(row._time).toISOString();
    if (row.alias === "energy_hp" || row.alias === "energy_hc") {
      hpHcByTime.set(time, (hpHcByTime.get(time) ?? 0) + row._value);
    } else if (row.alias === "energy") {
      legacyByTime.set(time, (legacyByTime.get(time) ?? 0) + row._value);
    }
  }

  const allTimes = new Set([...hpHcByTime.keys(), ...legacyByTime.keys()]);
  const points: EnergyByUsagePoint[] = [];
  for (const time of allTimes) {
    const wh = hpHcByTime.get(time) ?? legacyByTime.get(time) ?? 0;
    if (wh > 0) points.push({ time, wh });
  }
  points.sort((a, b) => a.time.localeCompare(b.time));
  return points;
}

/** Deterministic pastel palette for submeter colors. Medium saturation,
 *  modern dashboard feel — readable on light background, comfortable
 *  next to the brighter HP/HC/autoconso bars of the total chart.
 *  Mirrored in `ui/src/components/energy/submeterPalette.ts` (spec 117)
 *  so the Live donut paints each submeter with the same color the
 *  historical By-usage chart assigns to it. Update both in lockstep. */
const SUBMETER_PALETTE = [
  "#60A5FA", // soft blue
  "#34D399", // emerald
  "#F87171", // soft red
  "#A78BFA", // lavender
  "#22D3EE", // cyan
  "#FB7185", // coral pink
  "#FBBF24", // soft amber
  "#818CF8", // pale indigo
];

/** Spec 123 — local 4-decimal rounding mirror of cost-calculator. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function pickPaletteColor(index: number): string {
  return SUBMETER_PALETTE[index % SUBMETER_PALETTE.length];
}

function computeTotals(points: EnergyPoint[], prices: TariffPrices): EnergyTotals {
  let totalHp = 0;
  let totalHc = 0;
  let totalProduction = 0;
  let totalAutoconso = 0;
  let totalInjection = 0;
  for (const p of points) {
    // hp and hc include autoconsumption (total household consumption split by tariff).
    // Subtract autoconso per-point to get grid-only HP/HC, distributing proportionally
    // when a point straddles a tariff boundary (both hp and hc > 0).
    const conso = p.hp + p.hc;
    if (conso > 0 && p.autoconso > 0) {
      totalHp += Math.max(0, p.hp - p.autoconso * (p.hp / conso));
      totalHc += Math.max(0, p.hc - p.autoconso * (p.hc / conso));
    } else {
      totalHp += p.hp;
      totalHc += p.hc;
    }
    totalProduction += p.prod;
    totalAutoconso += p.autoconso;
    totalInjection += p.injection;
  }
  // Spec 123 — totals cost reflects the grid-side hp/hc (post autoconso
  // subtraction) so the summary card matches what the user actually
  // pays the utility.
  const totalsCost = computeCost(totalHp, totalHc, prices);
  return {
    total_consumption: totalHp + totalHc,
    total_hp: totalHp,
    total_hc: totalHc,
    total_production: totalProduction,
    total_autoconso: totalAutoconso,
    total_injection: totalInjection,
    cost_hp: totalsCost.cost_hp,
    cost_hc: totalsCost.cost_hc,
    cost_total: totalsCost.cost_total,
  };
}
