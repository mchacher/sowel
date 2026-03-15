#!/usr/bin/env npx tsx
/**
 * Read today's raw 30-min energy data from the raw bucket and aggregate
 * into the hourly and daily buckets. This bypasses the InfluxDB task's
 * -2h lookback limitation for same-day data.
 *
 * Usage:
 *   npx tsx scripts/energy-aggregate-today.ts [YYYY-MM-DD]
 */

import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

const DB_PATH = "./data/sowel.db";

const targetDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const db = new Database(DB_PATH, { readonly: true });

function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

const influxUrl = getSetting("history.influx.url")!;
const influxToken = getSetting("history.influx.token")!;
const influxOrg = getSetting("history.influx.org")!;
const influxBucket = getSetting("history.influx.bucket")!;

const eqRow = db.prepare("SELECT id, zone_id FROM equipments WHERE type = 'main_energy_meter'").get() as
  | { id: string; zone_id: string }
  | undefined;
if (!eqRow) { console.error("No main_energy_meter found."); process.exit(1); }
const equipmentId = eqRow.id;
const zoneId = eqRow.zone_id ?? "00000000-0000-0000-0000-000000000001";

db.close();

const rawBucket = influxBucket;
const hourlyBucket = `${influxBucket}-energy-hourly`;
const dailyBucket = `${influxBucket}-energy-daily`;

const influxClient = new InfluxDB({ url: influxUrl, token: influxToken });

async function run(): Promise<void> {
  // Use local time for day boundaries (CET/CEST)
  const dayStart = new Date(targetDate + "T00:00:00");
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  console.log(`Aggregating ${targetDate} raw → hourly + daily`);
  console.log(`  Raw bucket: ${rawBucket}`);
  console.log(`  Hourly bucket: ${hourlyBucket}`);
  console.log(`  Daily bucket: ${dailyBucket}`);
  console.log(`  Equipment: ${equipmentId}`);
  console.log(`  Range: ${dayStart.toISOString()} → ${dayEnd.toISOString()}`);

  // Step 1: Read all raw 30-min points for the day
  const queryApi = influxClient.getQueryApi(influxOrg);
  const flux = `from(bucket: "${rawBucket}")
  |> range(start: ${dayStart.toISOString()}, stop: ${dayEnd.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  // Group by hour
  const hourlyTotals = new Map<number, number>();
  let rawCount = 0;

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value == null || row._value <= 0) continue;

    const d = new Date(row._time);
    // Round down to the hour (UTC)
    const hourTs = Math.floor(d.getTime() / 3_600_000) * 3600;
    hourlyTotals.set(hourTs, (hourlyTotals.get(hourTs) ?? 0) + row._value);
    rawCount++;
  }

  console.log(`\nRead ${rawCount} raw points → ${hourlyTotals.size} hours`);

  if (hourlyTotals.size === 0) {
    console.log("No data to aggregate.");
    return;
  }

  // Step 2: Delete existing hourly data for this day (avoid duplicates)
  console.log("\nDeleting existing hourly data for this day...");
  const delHourly = await fetch(
    `${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${hourlyBucket}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${influxToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: dayStart.toISOString(),
        stop: dayEnd.toISOString(),
        predicate: `_measurement="equipment_data" AND equipmentId="${equipmentId}"`,
      }),
    },
  );
  if (!delHourly.ok) console.warn(`  Delete hourly failed: ${delHourly.status} ${await delHourly.text()}`);
  else console.log("  Deleted existing hourly data.");

  // Step 3: Write hourly points
  const hourlyWriteApi = influxClient.getWriteApi(influxOrg, hourlyBucket, "s", {
    batchSize: 100,
    flushInterval: 5000,
    maxRetries: 3,
  });

  let dayTotal = 0;
  const sortedHours = [...hourlyTotals.entries()].sort((a, b) => a[0] - b[0]);

  for (const [hourTs, totalWh] of sortedHours) {
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", "energy")
      .tag("category", "energy")
      .tag("type", "number")
      .tag("zoneId", zoneId)
      .floatField("value_number", totalWh)
      .timestamp(hourTs);
    hourlyWriteApi.writePoint(point);

    dayTotal += totalWh;
    const d = new Date(hourTs * 1000);
    console.log(`  ${d.toISOString()} → ${totalWh} Wh`);
  }

  await hourlyWriteApi.close();
  console.log(`\nWritten ${sortedHours.length} hourly points to ${hourlyBucket}`);

  // Step 4: Delete existing daily data for this day
  console.log("\nDeleting existing daily data for this day...");
  const delDaily = await fetch(
    `${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${dailyBucket}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${influxToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: dayStart.toISOString(),
        stop: dayEnd.toISOString(),
        predicate: `_measurement="equipment_data" AND equipmentId="${equipmentId}"`,
      }),
    },
  );
  if (!delDaily.ok) console.warn(`  Delete daily failed: ${delDaily.status} ${await delDaily.text()}`);
  else console.log("  Deleted existing daily data.");

  // Step 5: Write daily point
  const dailyWriteApi = influxClient.getWriteApi(influxOrg, dailyBucket, "s", {
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 3,
  });

  const dayStartTs = Math.floor(dayStart.getTime() / 1000);
  const dailyPoint = new Point("equipment_data")
    .tag("equipmentId", equipmentId)
    .tag("alias", "energy")
    .tag("category", "energy")
    .tag("type", "number")
    .tag("zoneId", zoneId)
    .floatField("value_number", dayTotal)
    .timestamp(dayStartTs);
  dailyWriteApi.writePoint(dailyPoint);

  await dailyWriteApi.close();
  console.log(`Written daily total: ${dayTotal} Wh (${(dayTotal / 1000).toFixed(2)} kWh) to ${dailyBucket}`);

  console.log("\nDone!");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
