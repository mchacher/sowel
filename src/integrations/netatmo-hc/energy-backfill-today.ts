#!/usr/bin/env npx tsx
/**
 * Rebuild today's energy data in InfluxDB from Netatmo API.
 *
 * 1. Deletes all energy data for today from sowel, sowel-energy-hourly, sowel-energy-daily
 * 2. Fetches ALL 30-min buckets since midnight in a single API call
 * 3. Aligns each bucket to its 30-min window (xx:00 or xx:30)
 * 4. Writes raw 30-min points to sowel bucket
 * 5. Aggregates and writes hourly sums to sowel-energy-hourly
 * 6. Aggregates and writes daily sum to sowel-energy-daily
 * 7. Updates lastEnergyTimestamp setting
 *
 * Usage:
 *   npx tsx src/integrations/netatmo-hc/energy-backfill-today.ts
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

// ============================================================
// Config
// ============================================================

const DB_PATH = "./data/sowel.db";
const TOKEN_PATH = "./data/netatmo-tokens.json";
const BRIDGE_ID = "00:04:74:44:d3:7c";
const NETATMO_BASE = "https://api.netatmo.com";
const SETTING_LAST_ENERGY_TS = "energy.legrand.lastEnergyTimestamp";
const HALF_HOUR = 1800;

const db = new Database(DB_PATH, { readonly: true });

function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

// InfluxDB config
const influxUrl = getSetting("history.influx.url")!;
const influxToken = getSetting("history.influx.token")!;
const influxOrg = getSetting("history.influx.org")!;
const influxBucket = getSetting("history.influx.bucket")!;

if (!influxUrl || !influxToken || !influxOrg || !influxBucket) {
  console.error("Missing InfluxDB configuration in settings.");
  process.exit(1);
}

// Netatmo config
const clientId = getSetting("integration.netatmo_hc.client_id")!;
const clientSecret = getSetting("integration.netatmo_hc.client_secret")!;

if (!clientId || !clientSecret) {
  console.error("Missing Netatmo client_id/client_secret in settings.");
  process.exit(1);
}

// Equipment ID
const eqRow = db
  .prepare("SELECT id, zone_id FROM equipments WHERE type = 'main_energy_meter'")
  .get() as { id: string; zone_id: string } | undefined;
if (!eqRow) {
  console.error("No main_energy_meter equipment found.");
  process.exit(1);
}
const equipmentId = eqRow.id;
const zoneId = eqRow.zone_id;

db.close();

// Netatmo tokens
let tokens: { refreshToken: string; accessToken: string; expiresAt: number };
try {
  tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
} catch {
  console.error(`Cannot read ${TOKEN_PATH}. Start the backend once first.`);
  process.exit(1);
}

// ============================================================
// Netatmo API
// ============================================================

async function refreshAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${NETATMO_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  tokens.accessToken = data.access_token;
  tokens.refreshToken = data.refresh_token;
  tokens.expiresAt = Date.now() + data.expires_in * 1000;
  console.log(`  Access token refreshed (expires in ${data.expires_in}s)`);
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  return refreshAccessToken();
}

const ENERGY_TYPES =
  "sum_energy_buy_from_grid$1,sum_energy_buy_from_grid$2,sum_energy_self_consumption";

/** Single API call from midnight — returns all 30-min buckets for today */
async function getMeasureFromMidnight(
  midnightTs: number,
): Promise<Record<string, (number | null)[]>> {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    device_id: BRIDGE_ID,
    module_id: BRIDGE_ID,
    type: ENERGY_TYPES,
    scale: "30min",
    optimize: "false",
    date_begin: String(midnightTs),
  });

  const res = await fetch(`${NETATMO_BASE}/api/getmeasure?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`getMeasure failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { body: Record<string, (number | null)[]> };
  return data.body;
}

// ============================================================
// Helpers
// ============================================================

const influxClient = new InfluxDB({ url: influxUrl, token: influxToken });

async function deleteEnergyDataForToday(
  bucket: string,
  todayStart: string,
  tomorrowStart: string,
): Promise<void> {
  const res = await fetch(`${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${bucket}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${influxToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: todayStart,
      stop: tomorrowStart,
      predicate: `_measurement="equipment_data" AND category="energy"`,
    }),
  });

  if (!res.ok) {
    console.warn(`  Delete from ${bucket} failed (${res.status}): ${await res.text()}`);
  } else {
    console.log(`  Deleted energy data from ${bucket}`);
  }
}

/** Align a raw Netatmo timestamp to the nearest 30-min boundary (floor) */
function alignTo30min(ts: number): number {
  return ts - (ts % HALF_HOUR);
}

// ============================================================
// Main
// ============================================================

async function run(): Promise<void> {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowMidnight = new Date(todayMidnight);
  tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

  const todayStr = todayMidnight.toISOString();
  const tomorrowStr = tomorrowMidnight.toISOString();
  const midnightTs = Math.floor(todayMidnight.getTime() / 1000);

  console.log("=".repeat(60));
  console.log("Energy Today Rebuild (single API call)");
  console.log(`  Date: ${todayMidnight.toISOString().slice(0, 10)}`);
  console.log(`  Now: ${now.toISOString()}`);
  console.log(`  Equipment: ${equipmentId}`);
  console.log(`  Bridge: ${BRIDGE_ID}`);
  console.log("=".repeat(60));

  // Step 1: Delete existing data for today
  console.log("\n[1/4] Deleting existing energy data for today...");
  await deleteEnergyDataForToday(influxBucket, todayStr, tomorrowStr);
  await deleteEnergyDataForToday(`${influxBucket}-energy-hourly`, todayStr, tomorrowStr);
  await deleteEnergyDataForToday(`${influxBucket}-energy-daily`, todayStr, tomorrowStr);

  // Step 2: Fetch all buckets from Netatmo in a single call
  console.log("\n[2/4] Fetching all energy buckets from Netatmo API (single call)...");
  const body = await getMeasureFromMidnight(midnightTs);
  const timestamps = Object.keys(body)
    .map(Number)
    .sort((a, b) => a - b);
  console.log(`  Received ${timestamps.length} buckets from API`);

  // Step 3: Process buckets — align timestamps and write to InfluxDB
  console.log("\n[3/4] Writing raw 30-min points to sowel bucket...");

  const rawWriteApi = influxClient.getWriteApi(influxOrg, influxBucket, "s", {
    batchSize: 500,
    flushInterval: 5_000,
    maxRetries: 3,
  });

  const hourlyTotals = new Map<number, number>(); // hourTs → Wh
  let dayTotal = 0;
  let rawPoints = 0;
  let lastAlignedTs = 0;

  for (const ts of timestamps) {
    const values = body[String(ts)];
    const totalWh = (values[0] ?? 0) + (values[1] ?? 0) + (values[2] ?? 0);

    if (totalWh <= 0) continue;

    // Align to 30-min boundary
    const alignedTs = alignTo30min(ts);

    // Write raw point
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", "energy")
      .tag("category", "energy")
      .tag("type", "number")
      .tag("zoneId", zoneId)
      .floatField("value_number", totalWh)
      .timestamp(alignedTs);
    rawWriteApi.writePoint(point);
    rawPoints++;

    // Hourly aggregate — group by hour start
    const hourTs = alignedTs - (alignedTs % 3600);
    hourlyTotals.set(hourTs, (hourlyTotals.get(hourTs) ?? 0) + totalWh);

    dayTotal += totalWh;
    lastAlignedTs = Math.max(lastAlignedTs, alignedTs);

    const cetTime = new Date(alignedTs * 1000 + 3600000).toISOString().slice(11, 16);
    console.log(`  ${cetTime} CET → ${totalWh} Wh (raw ts: ${ts}, aligned: ${alignedTs})`);
  }

  try {
    await rawWriteApi.close();
    console.log(`  Written ${rawPoints} raw points`);
  } catch (err) {
    console.error("  Error flushing raw writes:", err);
  }

  // Step 4: Write hourly and daily aggregates
  console.log("\n[4/4] Writing hourly and daily aggregates...");

  // Hourly
  const hourlyWriteApi = influxClient.getWriteApi(influxOrg, `${influxBucket}-energy-hourly`, "s", {
    batchSize: 100,
    flushInterval: 5_000,
    maxRetries: 3,
  });

  for (const [hourTs, totalWh] of hourlyTotals) {
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", "energy")
      .tag("category", "energy")
      .tag("type", "number")
      .tag("zoneId", zoneId)
      .floatField("value_number", totalWh)
      .timestamp(hourTs);
    hourlyWriteApi.writePoint(point);
  }

  try {
    await hourlyWriteApi.close();
    console.log(`  Written ${hourlyTotals.size} hourly points`);
  } catch (err) {
    console.error("  Error flushing hourly writes:", err);
  }

  // Daily
  const dailyWriteApi = influxClient.getWriteApi(influxOrg, `${influxBucket}-energy-daily`, "s", {
    batchSize: 10,
    flushInterval: 5_000,
    maxRetries: 3,
  });

  const dayPoint = new Point("equipment_data")
    .tag("equipmentId", equipmentId)
    .tag("alias", "energy")
    .tag("category", "energy")
    .tag("type", "number")
    .tag("zoneId", zoneId)
    .floatField("value_number", dayTotal)
    .timestamp(midnightTs);
  dailyWriteApi.writePoint(dayPoint);

  try {
    await dailyWriteApi.close();
    console.log(`  Written 1 daily point (${dayTotal} Wh)`);
  } catch (err) {
    console.error("  Error flushing daily writes:", err);
  }

  // Update lastEnergyTimestamp
  const dbRW = new Database(DB_PATH);
  dbRW
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(SETTING_LAST_ENERGY_TS, String(lastAlignedTs));
  dbRW.close();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Rebuild complete!");
  console.log(`  Raw 30-min points: ${rawPoints}`);
  console.log(`  Hourly points: ${hourlyTotals.size}`);
  console.log(`  Day total: ${dayTotal} Wh (${(dayTotal / 1000).toFixed(2)} kWh)`);
  console.log(`  lastEnergyTimestamp updated to: ${lastAlignedTs}`);

  // Print hourly breakdown
  console.log("\n  Hourly breakdown (CET):");
  const sortedHours = [...hourlyTotals.entries()].sort((a, b) => a[0] - b[0]);
  for (const [hourTs, wh] of sortedHours) {
    const cetHour = new Date(hourTs * 1000 + 3600000).toISOString().slice(11, 16);
    console.log(`    ${cetHour} → ${wh} Wh (${(wh / 1000).toFixed(2)} kWh)`);
  }
  console.log("=".repeat(60));
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
