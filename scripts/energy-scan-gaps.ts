#!/usr/bin/env npx tsx
/**
 * Scan InfluxDB energy-daily bucket for gaps in 2025.
 * Lists all missing days.
 */

import Database from "better-sqlite3";
import { InfluxDB } from "@influxdata/influxdb-client";

const db = new Database("./data/sowel.db", { readonly: true });
function getSetting(k: string) {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
}
const influxUrl = getSetting("history.influx.url")!;
const influxToken = getSetting("history.influx.token")!;
const influxOrg = getSetting("history.influx.org")!;
const influxBucket = getSetting("history.influx.bucket")!;
const eqRow = db.prepare("SELECT id FROM equipments WHERE type = 'main_energy_meter'").get() as { id: string };
db.close();

const client = new InfluxDB({ url: influxUrl, token: influxToken });

async function run() {
  const queryApi = client.getQueryApi(influxOrg);

  // Check daily bucket for 2025
  const flux = `from(bucket: "${influxBucket}-energy-daily")
  |> range(start: 2025-01-01T00:00:00Z, stop: 2026-01-01T00:00:00Z)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${eqRow.id}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const days = new Map<string, number>();
  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    // The timestamp is at midnight UTC of the day before (CET day starts at 23:00 UTC previous day)
    // But our backfill writes at local midnight → which is 23:00 UTC previous day
    const d = new Date(row._time);
    const key = d.toISOString().slice(0, 10);
    days.set(key, row._value);
  }

  console.log(`Found ${days.size} days with data in daily bucket for 2025\n`);

  // Find gaps — check from Jan 1 to Dec 31
  const start = new Date("2025-01-01T12:00:00");
  const end = new Date("2025-12-31T12:00:00");
  const missing: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    const key = d.toISOString().slice(0, 10);
    if (!days.has(key)) missing.push(key);
    d.setDate(d.getDate() + 1);
  }

  if (missing.length === 0) {
    console.log("No gaps found!");
  } else {
    // Group consecutive missing dates into ranges for readability
    let rangeStart = missing[0];
    let prev = missing[0];
    const ranges: string[] = [];

    for (let i = 1; i < missing.length; i++) {
      const prevD = new Date(prev + "T12:00:00");
      const currD = new Date(missing[i] + "T12:00:00");
      const diffDays = (currD.getTime() - prevD.getTime()) / 86_400_000;
      if (diffDays > 1) {
        ranges.push(rangeStart === prev ? rangeStart : `${rangeStart} → ${prev}`);
        rangeStart = missing[i];
      }
      prev = missing[i];
    }
    ranges.push(rangeStart === prev ? rangeStart : `${rangeStart} → ${prev}`);

    console.log(`Missing ${missing.length} days in ${ranges.length} gap(s):`);
    for (const r of ranges) console.log(`  ${r}`);
  }

  // Also check hourly bucket for the days that DO have daily data
  // Sample a few days to see if they have 24 hourly entries
  console.log("\n--- Hourly coverage spot-check ---");
  const sampleDays = Array.from(days.keys()).sort().filter((_, i, arr) => i % 30 === 0 || i === arr.length - 1);

  for (const day of sampleDays) {
    const dayStart = new Date(day + "T00:00:00");
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const hFlux = `from(bucket: "${influxBucket}-energy-hourly")
    |> range(start: ${dayStart.toISOString()}, stop: ${dayEnd.toISOString()})
    |> filter(fn: (r) => r._measurement == "equipment_data")
    |> filter(fn: (r) => r.equipmentId == "${eqRow.id}")
    |> filter(fn: (r) => r.category == "energy")
    |> filter(fn: (r) => r._field == "value_number")`;

    let count = 0;
    let total = 0;
    const hRows = queryApi.iterateRows(hFlux);
    for await (const { values, tableMeta } of hRows) {
      const row = tableMeta.toObject(values) as { _value: number };
      count++;
      total += row._value;
    }

    const dailyWh = days.get(day) ?? 0;
    const match = Math.abs(total - dailyWh) < 1 ? "✓" : `⚠ hourly=${(total/1000).toFixed(2)} vs daily=${(dailyWh/1000).toFixed(2)}`;
    console.log(`  ${day}: ${count} hourly points ${match}`);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
