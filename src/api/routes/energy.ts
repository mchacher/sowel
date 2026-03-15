import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { TariffClassifier } from "../../energy/tariff-classifier.js";
import type { InfluxClient } from "../../history/influx-client.js";
import type {
  EnergyPoint,
  EnergyTotals,
  EnergyHistoryResponse,
  EnergyStatus,
  TariffConfig,
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

  // ============================================================
  // GET /api/v1/energy/status
  // ============================================================
  app.get("/api/v1/energy/status", async (): Promise<EnergyStatus> => {
    const eqId = findEnergyEquipmentId(equipmentManager);
    const prodId = findProductionEquipmentId(equipmentManager);
    return {
      available: eqId !== null,
      hasProduction: prodId !== null,
      sources: eqId ? ["legrand"] : [],
      lastDataAt: null, // TODO: query InfluxDB for latest point
      tariffConfigured: tariffClassifier.getConfig() !== null,
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

      // Query production data if production Equipment exists
      const prodMap = new Map<string, { prod: number; autoconso: number; injection: number }>();
      if (productionEquipmentId) {
        const prodPoints = await queryProductionPoints(
          client,
          config.org,
          bucket,
          productionEquipmentId,
          from,
          to,
          resolution,
        );
        for (const p of prodPoints) {
          prodMap.set(p.time, p);
        }
      }

      // Build final EnergyPoint array
      const points: EnergyPoint[] = [];
      const allTimes = new Set([...consumptionPoints.map((p) => p.time), ...prodMap.keys()]);
      const sortedTimes = [...allTimes].sort();

      for (const time of sortedTimes) {
        const conso = consumptionPoints.find((p) => p.time === time);
        const hp = conso?.hp ?? 0;
        const hc = conso?.hc ?? 0;
        const prodData = prodMap.get(time);
        const prod = prodData?.prod ?? 0;
        const autoconso = prodData?.autoconso ?? 0;
        const injection = prodData?.injection ?? 0;

        if (hp + hc > 0 || prod > 0) {
          points.push({ time, hp, hc, prod, autoconso, injection });
        }
      }

      const totals = computeTotals(points);

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
  // GET /api/v1/settings/energy/tariff
  // ============================================================
  app.get("/api/v1/settings/energy/tariff", async () => {
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

function computeRange(
  period: string,
  dateStr: string,
  baseBucket: string,
): { from: Date; to: Date; resolution: "5min" | "1h" | "1d"; bucket: string } {
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
      return { from, to, resolution: "1h", bucket: `${baseBucket}-energy-hourly` };
    }
    case "month": {
      const from = new Date(date.getFullYear(), date.getMonth(), 1);
      const to = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-daily` };
    }
    case "year": {
      const from = new Date(date.getFullYear(), 0, 1);
      const to = new Date(date.getFullYear() + 1, 0, 1);
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-daily` };
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
 */
async function queryEnergyHpHcPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  _resolution: "5min" | "1h" | "1d",
): Promise<Array<{ time: string; hp: number; hc: number }>> {
  const queryApi = client.getQueryApi(org);
  const needsAggregation = _resolution === "1h" && !bucket.includes("-energy-");

  // Query both energy_hp and energy_hc in a single Flux query using alias filter
  const aliasFilter = `r.alias == "energy_hp" or r.alias == "energy_hc"`;
  const flux = needsAggregation
    ? `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`
    : `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  // Collect HP and HC values indexed by timestamp
  const hpMap = new Map<string, number>();
  const hcMap = new Map<string, number>();

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number; alias: string };
    if (row._value == null) continue;
    if (row.alias === "energy_hp") {
      hpMap.set(row._time, (hpMap.get(row._time) ?? 0) + row._value);
    } else if (row.alias === "energy_hc") {
      hcMap.set(row._time, (hcMap.get(row._time) ?? 0) + row._value);
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
  _resolution: "5min" | "1h" | "1d",
): Promise<Array<{ time: string; hp: number; hc: number }>> {
  const queryApi = client.getQueryApi(org);
  const needsAggregation = _resolution === "1h" && !bucket.includes("-energy-");

  const flux = needsAggregation
    ? `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`
    : `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const points: Array<{ time: string; hp: number; hc: number }> = [];
  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value != null && row._value > 0) {
      points.push({ time: row._time, hp: row._value, hc: 0 });
    }
  }

  return points;
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
  _resolution: "5min" | "1h" | "1d",
): Promise<Array<{ time: string; prod: number; autoconso: number; injection: number }>> {
  const queryApi = client.getQueryApi(org);
  const needsAggregation = _resolution === "1h" && !bucket.includes("-energy-");

  const aliasFilter = `r.alias == "energy" or r.alias == "autoconso" or r.alias == "injection"`;
  const flux = needsAggregation
    ? `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`
    : `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => ${aliasFilter})
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const prodMap = new Map<string, number>();
  const autoMap = new Map<string, number>();
  const injMap = new Map<string, number>();

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number; alias: string };
    if (row._value == null) continue;
    if (row.alias === "energy") {
      prodMap.set(row._time, (prodMap.get(row._time) ?? 0) + row._value);
    } else if (row.alias === "autoconso") {
      autoMap.set(row._time, (autoMap.get(row._time) ?? 0) + row._value);
    } else if (row.alias === "injection") {
      injMap.set(row._time, (injMap.get(row._time) ?? 0) + row._value);
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

function computeTotals(points: EnergyPoint[]): EnergyTotals {
  let totalHp = 0;
  let totalHc = 0;
  let totalProduction = 0;
  let totalAutoconso = 0;
  let totalInjection = 0;
  for (const p of points) {
    totalHp += p.hp;
    totalHc += p.hc;
    totalProduction += p.prod;
    totalAutoconso += p.autoconso;
    totalInjection += p.injection;
  }
  return {
    total_consumption: totalHp + totalHc,
    total_hp: totalHp,
    total_hc: totalHc,
    total_production: totalProduction,
    total_autoconso: totalAutoconso,
    total_injection: totalInjection,
  };
}
