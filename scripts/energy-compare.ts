#!/usr/bin/env npx tsx
/**
 * Force InfluxDB hourly task then compare raw-aggregated vs hourly bucket.
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

const equipmentId = eqRow.id;
const client = new InfluxDB({ url: influxUrl, token: influxToken });

async function run() {
  // Step 1: Find and force the hourly aggregation task
  console.log("=== Step 1: Finding InfluxDB tasks ===");
  const tasksRes = await fetch(`${influxUrl}/api/v2/tasks?org=${influxOrg}`, {
    headers: { Authorization: `Token ${influxToken}` },
  });
  const tasksData = (await tasksRes.json()) as { tasks: Array<{ id: string; name: string; status: string }> };
  
  for (const t of tasksData.tasks) {
    console.log(`  Task: ${t.name} (${t.id}) — ${t.status}`);
  }

  const hourlyTask = tasksData.tasks.find(t => t.name.toLowerCase().includes("hourly") || t.name.toLowerCase().includes("energy"));
  if (hourlyTask) {
    console.log(`\nForcing task: ${hourlyTask.name} (${hourlyTask.id})`);
    const runRes = await fetch(`${influxUrl}/api/v2/tasks/${hourlyTask.id}/runs`, {
      method: "POST",
      headers: { Authorization: `Token ${influxToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (runRes.ok) {
      const runData = await runRes.json();
      console.log(`  Run triggered: ${JSON.stringify(runData)}`);
      // Wait for the task to complete
      console.log("  Waiting 10s for task to complete...");
      await new Promise(r => setTimeout(r, 10000));
    } else {
      console.log(`  Force run failed: ${runRes.status} ${await runRes.text()}`);
    }
  } else {
    console.log("\nNo hourly task found. Listing all tasks above.");
  }

  // Step 2: Query raw bucket with aggregateWindow
  console.log("\n=== Step 2: Query RAW bucket (aggregateWindow hourly) ===");
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(today + "T00:00:00");
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const queryApi = client.getQueryApi(influxOrg);

  const rawFlux = `from(bucket: "${influxBucket}")
  |> range(start: ${dayStart.toISOString()}, stop: ${dayEnd.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`;

  const rawPoints = new Map<string, number>();
  let rawTotal = 0;
  const rawRows = queryApi.iterateRows(rawFlux);
  for await (const { values, tableMeta } of rawRows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value != null && row._value > 0) {
      const hour = row._time.slice(0, 13);
      rawPoints.set(hour, row._value);
      rawTotal += row._value;
      console.log(`  ${row._time} → ${row._value} Wh (${(row._value/1000).toFixed(3)} kWh)`);
    }
  }
  console.log(`  TOTAL raw: ${rawTotal} Wh (${(rawTotal/1000).toFixed(2)} kWh)`);

  // Step 3: Query hourly bucket
  console.log("\n=== Step 3: Query HOURLY bucket ===");
  const hourlyFlux = `from(bucket: "${influxBucket}-energy-hourly")
  |> range(start: ${dayStart.toISOString()}, stop: ${dayEnd.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const hourlyPoints = new Map<string, number>();
  let hourlyTotal = 0;
  const hourlyRows = queryApi.iterateRows(hourlyFlux);
  for await (const { values, tableMeta } of hourlyRows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value != null && row._value > 0) {
      const hour = row._time.slice(0, 13);
      hourlyPoints.set(hour, row._value);
      hourlyTotal += row._value;
      console.log(`  ${row._time} → ${row._value} Wh (${(row._value/1000).toFixed(3)} kWh)`);
    }
  }
  console.log(`  TOTAL hourly: ${hourlyTotal} Wh (${(hourlyTotal/1000).toFixed(2)} kWh)`);

  // Step 4: Compare
  console.log("\n=== Step 4: Comparison (hour by hour) ===");
  const allHours = new Set([...rawPoints.keys(), ...hourlyPoints.keys()]);
  const sorted = [...allHours].sort();
  
  let mismatches = 0;
  for (const hour of sorted) {
    const raw = rawPoints.get(hour) ?? 0;
    const hourly = hourlyPoints.get(hour) ?? 0;
    const diff = Math.abs(raw - hourly);
    const match = diff < 1 ? "✓" : `⚠ diff=${diff.toFixed(1)} Wh`;
    if (diff >= 1) mismatches++;
    console.log(`  ${hour}:00  raw=${(raw/1000).toFixed(3)} kWh  hourly=${(hourly/1000).toFixed(3)} kWh  ${match}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Raw total:    ${(rawTotal/1000).toFixed(2)} kWh`);
  console.log(`  Hourly total: ${(hourlyTotal/1000).toFixed(2)} kWh`);
  console.log(`  Difference:   ${(Math.abs(rawTotal - hourlyTotal)/1000).toFixed(2)} kWh`);
  console.log(`  Mismatches:   ${mismatches}/${sorted.length} hours`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
