#!/usr/bin/env npx tsx
/**
 * Update InfluxDB energy tasks: timeSrc="_start" + -7h lookback
 */
import Database from "better-sqlite3";

const db = new Database("./data/sowel.db", { readonly: true });
function getSetting(k: string) {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
}
const influxUrl = getSetting("history.influx.url")!;
const influxToken = getSetting("history.influx.token")!;
const influxOrg = getSetting("history.influx.org")!;
db.close();

async function updateTask(taskName: string, newFlux: string) {
  const res = await fetch(`${influxUrl}/api/v2/tasks?org=${influxOrg}`, {
    headers: { Authorization: `Token ${influxToken}` },
  });
  const data = (await res.json()) as { tasks: Array<{ id: string; name: string; flux: string }> };
  const task = data.tasks.find(t => t.name === taskName);
  if (!task) { console.error(`Task ${taskName} not found`); return; }

  console.log(`\n--- ${taskName} ---`);
  console.log("Current:", task.flux.replace(/\n/g, " ").slice(0, 120) + "...");

  const updateRes = await fetch(`${influxUrl}/api/v2/tasks/${task.id}`, {
    method: "PATCH",
    headers: { Authorization: `Token ${influxToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ flux: newFlux }),
  });

  if (updateRes.ok) {
    console.log("✓ Updated");
  } else {
    console.error("✗ Failed:", updateRes.status, await updateRes.text());
  }
}

async function run() {
  await updateTask("sowel-energy-sum-hourly", `option task = {name: "sowel-energy-sum-hourly", every: 1h}

from(bucket: "sowel")
  |> range(start: -7h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> to(bucket: "sowel-energy-hourly", org: "sowel")`);

  await updateTask("sowel-energy-sum-daily", `option task = {name: "sowel-energy-sum-daily", every: 1d}

from(bucket: "sowel-energy-hourly")
  |> range(start: -2d)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.category == "energy")
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> to(bucket: "sowel-energy-daily", org: "sowel")`);

  console.log("\nDone!");
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
