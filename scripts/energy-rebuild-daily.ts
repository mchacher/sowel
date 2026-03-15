#!/usr/bin/env npx tsx
/**
 * Rebuild the energy-daily bucket from energy-hourly data.
 * Groups hourly points by LOCAL date (CET/CEST) and writes one daily point per day.
 *
 * Usage:
 *   npx tsx scripts/energy-rebuild-daily.ts
 */

import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

const DB_PATH = "./data/sowel.db";
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

const eqRow = db.prepare("SELECT id FROM equipments WHERE type = 'main_energy_meter'").get() as
  | { id: string }
  | undefined;
if (!eqRow) { console.error("No main_energy_meter found."); process.exit(1); }
const equipmentId = eqRow.id;

db.close();

const hourlyBucket = `${influxBucket}-energy-hourly`;
const dailyBucket = `${influxBucket}-energy-daily`;
const influxClient = new InfluxDB({ url: influxUrl, token: influxToken });

/** Convert a UTC timestamp to local date key "YYYY-MM-DD" */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function run(): Promise<void> {
  console.log("Reading all hourly data...");

  const queryApi = influxClient.getQueryApi(influxOrg);
  const flux = `from(bucket: "${hourlyBucket}")
  |> range(start: 2025-01-01T00:00:00Z, stop: 2027-01-01T00:00:00Z)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  // Group by local date
  const dailyTotals = new Map<string, number>();
  let totalPoints = 0;

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value == null || row._value <= 0) continue;

    const d = new Date(row._time);
    const key = localDateKey(d);
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + row._value);
    totalPoints++;
  }

  console.log(`Read ${totalPoints} hourly points → ${dailyTotals.size} days`);

  // Delete existing daily data
  console.log("Deleting existing daily data...");
  const res = await fetch(`${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${dailyBucket}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${influxToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: "1970-01-01T00:00:00Z",
      stop: new Date(Date.now() + 86_400_000).toISOString(),
      predicate: `_measurement="equipment_data"`,
    }),
  });
  if (!res.ok) console.warn(`Delete failed: ${res.status} ${await res.text()}`);
  else console.log("Deleted.");

  // Write new daily points
  console.log("Writing daily points...");
  const writeApi = influxClient.getWriteApi(influxOrg, dailyBucket, "s", {
    batchSize: 500,
    flushInterval: 10_000,
    maxRetries: 3,
  });

  const sortedDays = [...dailyTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dayKey, totalWh] of sortedDays) {
    // Use UTC midnight for the daily point timestamp
    const dayTimestamp = Math.floor(new Date(dayKey + "T00:00:00Z").getTime() / 1000);
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", "energy")
      .tag("category", "energy")
      .tag("type", "number")
      .floatField("value_number", totalWh)
      .timestamp(dayTimestamp);
    writeApi.writePoint(point);

    console.log(`  ${dayKey}: ${(totalWh / 1000).toFixed(2)} kWh`);
  }

  await writeApi.close();
  console.log(`\nDone! Written ${sortedDays.length} daily points.`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
