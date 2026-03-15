#!/usr/bin/env npx tsx
/**
 * Classify existing historical energy data into energy_hp / energy_hc.
 *
 * Strategy per bucket:
 * - Raw (30-min windows): classify each point with 30-min prorata
 * - Hourly: classify each point with 60-min prorata
 * - Daily: sum hourly HP/HC for each day (no prorata — uses actual consumption distribution)
 *
 * IMPORTANT: Backup your InfluxDB data before running this script!
 *
 * Usage:
 *   npx tsx scripts/energy/classify-hphc.ts
 */

import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

const DB_PATH = "./data/sowel.db";

// ============================================================
// Config from SQLite
// ============================================================

const db = new Database(DB_PATH, { readonly: true });

function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

const influxUrl = getSetting("history.influx.url");
const influxToken = getSetting("history.influx.token");
const influxOrg = getSetting("history.influx.org");
const influxBucket = getSetting("history.influx.bucket");

if (!influxUrl || !influxToken || !influxOrg || !influxBucket) {
  console.error("InfluxDB not configured in settings.");
  process.exit(1);
}

// ============================================================
// Tariff schedule from settings
// ============================================================

interface TariffSlot {
  start: string;
  end: string;
  tariff: "hp" | "hc";
}

interface DaySchedule {
  days: number[];
  slots: TariffSlot[];
}

interface TariffConfig {
  schedules: DaySchedule[];
  prices: { hp: number; hc: number };
}

const tariffRaw = getSetting("energy.tariff");
if (!tariffRaw) {
  console.error(
    "No tariff schedule configured. Configure it in Settings > Énergie first.",
  );
  process.exit(1);
}

const tariffConfig: TariffConfig = JSON.parse(tariffRaw);
console.log(
  `Tariff schedule loaded: ${tariffConfig.schedules.length} schedule(s), HP=${tariffConfig.prices.hp} €/kWh, HC=${tariffConfig.prices.hc} €/kWh`,
);

db.close();

// ============================================================
// Tariff classification
// ============================================================

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Classify a fixed-duration window into HP/HC split using linear prorata.
 * @param totalWh Total energy in Wh for the window
 * @param timestampEpochS Window start as Unix epoch seconds
 * @param windowMinutes Duration of the window in minutes (30 for raw, 60 for hourly)
 */
function classify(
  totalWh: number,
  timestampEpochS: number,
  windowMinutes: number,
): { hp: number; hc: number } {
  const d = new Date(timestampEpochS * 1000);
  const dayOfWeek = d.getDay();

  const daySchedule = tariffConfig.schedules.find((s) =>
    s.days.includes(dayOfWeek),
  );
  if (!daySchedule || daySchedule.slots.length === 0) {
    return { hp: totalWh, hc: 0 };
  }

  const windowStartMinutes = d.getHours() * 60 + d.getMinutes();
  const windowEndMinutes = windowStartMinutes + windowMinutes;

  let hpMinutes = 0;
  let hcMinutes = 0;

  for (const slot of daySchedule.slots) {
    const slotStart = parseTimeToMinutes(slot.start);
    let slotEnd = parseTimeToMinutes(slot.end);
    if (slotEnd === 0) slotEnd = 1440;

    // Handle midnight wrap: e.g. 17:04 → 00:04 becomes [17:04, 24:00) + [00:00, 00:04)
    const ranges: Array<[number, number]> =
      slotEnd <= slotStart
        ? [[slotStart, 1440], [0, slotEnd]]
        : [[slotStart, slotEnd]];

    for (const [rangeStart, rangeEnd] of ranges) {
      const overlapStart = Math.max(windowStartMinutes, rangeStart);
      const overlapEnd = Math.min(windowEndMinutes, rangeEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > 0) {
        if (slot.tariff === "hp") hpMinutes += overlap;
        else hcMinutes += overlap;
      }
    }
  }

  const totalMinutes = hpMinutes + hcMinutes;
  if (totalMinutes === 0) return { hp: totalWh, hc: 0 };

  return {
    hp: Math.round((totalWh * hpMinutes) / totalMinutes),
    hc: Math.round((totalWh * hcMinutes) / totalMinutes),
  };
}

// ============================================================
// InfluxDB processing
// ============================================================

const influx = new InfluxDB({ url: influxUrl, token: influxToken });
const queryApi = influx.getQueryApi(influxOrg);

interface EnergyRow {
  _time: string;
  _value: number;
  equipmentId: string;
  category: string;
  zoneId: string;
  type: string;
}

/**
 * Delete existing energy_hp / energy_hc points from a bucket before re-writing.
 */
async function deleteHpHc(bucketName: string, range: string): Promise<void> {
  console.log(`  Deleting existing energy_hp/energy_hc from ${bucketName}...`);

  for (const alias of ["energy_hp", "energy_hc"]) {
    const resp = await fetch(
      `${influxUrl}/api/v2/delete?org=${encodeURIComponent(influxOrg!)}&bucket=${encodeURIComponent(bucketName)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${influxToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start: "2020-01-01T00:00:00Z",
          stop: "2030-01-01T00:00:00Z",
          predicate: `alias="${alias}"`,
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`  Failed to delete ${alias}: ${resp.status} ${text}`);
    }
  }
}

/**
 * Process raw or hourly bucket: classify each energy point with the appropriate window size.
 */
async function processWithProrata(
  bucketName: string,
  range: string,
  windowMinutes: number,
): Promise<number> {
  console.log(`\nProcessing bucket: ${bucketName} (range: ${range}, window: ${windowMinutes}min)...`);

  await deleteHpHc(bucketName, range);

  const flux = `from(bucket: "${bucketName}")
  |> range(start: ${range})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const rows: EnergyRow[] = [];
  const queryRows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of queryRows) {
    const row = tableMeta.toObject(values) as EnergyRow;
    if (row._value != null && row._value > 0) {
      rows.push(row);
    }
  }

  console.log(`  Found ${rows.length} energy points to classify.`);

  if (rows.length === 0) return 0;

  const writeApi = influx.getWriteApi(influxOrg!, bucketName, "s", {
    batchSize: 500,
    flushInterval: 10000,
    maxRetries: 3,
  });

  let written = 0;

  for (const row of rows) {
    const epochS = Math.floor(new Date(row._time).getTime() / 1000);
    const split = classify(row._value, epochS, windowMinutes);

    for (const [alias, value] of [
      ["energy_hp", split.hp],
      ["energy_hc", split.hc],
    ] as const) {
      const point = new Point("equipment_data")
        .tag("equipmentId", row.equipmentId)
        .tag("alias", alias)
        .tag("category", row.category)
        .tag("zoneId", row.zoneId)
        .tag("type", row.type)
        .floatField("value_number", value)
        .timestamp(epochS);

      writeApi.writePoint(point);
    }

    written++;
  }

  await writeApi.close();
  console.log(`  Wrote ${written * 2} HP/HC points (${written} energy × 2).`);
  return written;
}

/**
 * Process daily bucket by summing hourly HP/HC data for each day.
 * This is more accurate than prorata because it respects the actual
 * consumption distribution across hours.
 */
async function processDailyFromHourly(
  hourlyBucket: string,
  dailyBucket: string,
  range: string,
): Promise<number> {
  console.log(`\nProcessing daily bucket by summing hourly HP/HC...`);

  await deleteHpHc(dailyBucket, range);

  // Read hourly HP/HC data
  let totalWritten = 0;

  for (const alias of ["energy_hp", "energy_hc"] as const) {
    const flux = `from(bucket: "${hourlyBucket}")
    |> range(start: ${range})
    |> filter(fn: (r) => r._measurement == "equipment_data")
    |> filter(fn: (r) => r.alias == "${alias}")
    |> filter(fn: (r) => r.category == "energy")
    |> filter(fn: (r) => r._field == "value_number")
    |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")`;

    const rows: EnergyRow[] = [];
    const queryRows = queryApi.iterateRows(flux);
    for await (const { values, tableMeta } of queryRows) {
      const row = tableMeta.toObject(values) as EnergyRow;
      if (row._value != null && row._value > 0) {
        rows.push(row);
      }
    }

    console.log(`  ${alias}: ${rows.length} daily aggregations from hourly data.`);

    if (rows.length === 0) continue;

    const writeApi = influx.getWriteApi(influxOrg!, dailyBucket, "s", {
      batchSize: 500,
      flushInterval: 10000,
      maxRetries: 3,
    });

    for (const row of rows) {
      const epochS = Math.floor(new Date(row._time).getTime() / 1000);
      const point = new Point("equipment_data")
        .tag("equipmentId", row.equipmentId)
        .tag("alias", alias)
        .tag("category", row.category)
        .tag("zoneId", row.zoneId)
        .tag("type", row.type)
        .floatField("value_number", row._value)
        .timestamp(epochS);

      writeApi.writePoint(point);
      totalWritten++;
    }

    await writeApi.close();
  }

  console.log(`  Wrote ${totalWritten} daily HP/HC points.`);
  return totalWritten;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=== Energy HP/HC Classification Script (v2) ===");
  console.log("IMPORTANT: Make sure you have backed up your InfluxDB data!\n");

  const rawBucket = influxBucket!;
  const hourlyBucket = `${influxBucket}-energy-hourly`;
  const dailyBucket = `${influxBucket}-energy-daily`;

  // 1. Raw bucket (30-min windows, last 7 days — retention limit)
  await processWithProrata(rawBucket, "-7d", 30);

  // 2. Energy-hourly bucket (60-min windows, up to 2 years)
  await processWithProrata(hourlyBucket, "-730d", 60);

  // 3. Energy-daily bucket: sum hourly HP/HC (not prorata!)
  await processDailyFromHourly(hourlyBucket, dailyBucket, "-730d");

  console.log(`\n=== Done! ===`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
