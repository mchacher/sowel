#!/usr/bin/env npx tsx
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

  // Show raw 30-min points for today
  const dayStart = new Date("2026-03-14T00:00:00");
  const dayEnd = new Date("2026-03-15T00:00:00");

  console.log(`Raw points for 2026-03-14 (range ${dayStart.toISOString()} → ${dayEnd.toISOString()}):\n`);

  const flux = `from(bucket: "${influxBucket}")
  |> range(start: ${dayStart.toISOString()}, stop: ${dayEnd.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${eqRow.id}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;

  const rows = queryApi.iterateRows(flux);
  let count = 0;
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    const utc = new Date(row._time);
    const localHour = utc.getHours(); // Machine is CET
    console.log(`  ${row._time}  (local h=${localHour.toString().padStart(2,"0")})  → ${row._value} Wh`);
    count++;
  }
  console.log(`\nTotal: ${count} raw points`);

  // Also check the InfluxDB task flux query
  console.log("\n\n=== InfluxDB Task Flux ===");
  const tasksRes = await fetch(`${influxUrl}/api/v2/tasks?org=${influxOrg}`, {
    headers: { Authorization: `Token ${influxToken}` },
  });
  const tasksData = (await tasksRes.json()) as { tasks: Array<{ id: string; name: string; flux: string }> };
  for (const t of tasksData.tasks) {
    if (t.name.includes("energy")) {
      console.log(`\n--- ${t.name} ---`);
      console.log(t.flux);
    }
  }
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
