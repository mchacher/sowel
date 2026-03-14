#!/usr/bin/env npx tsx
/**
 * Backfill energy data from Netatmo into InfluxDB for a date range.
 * For each day: fetch 30-min raw data → write to raw bucket → aggregate hourly + daily.
 *
 * Usage:
 *   npx tsx scripts/energy-backfill-range.ts 2025-06-01 2025-09-13
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

const DB_PATH = "./data/sowel.db";
const TOKEN_PATH = "./data/netatmo-tokens.json";

const startDate = process.argv[2];
const endDate = process.argv[3];

if (!startDate || !endDate) {
  console.error("Usage: npx tsx scripts/energy-backfill-range.ts YYYY-MM-DD YYYY-MM-DD");
  process.exit(1);
}

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

const influxUrl = getSetting("history.influx.url")!;
const influxToken = getSetting("history.influx.token")!;
const influxOrg = getSetting("history.influx.org")!;
const influxBucket = getSetting("history.influx.bucket")!;
const clientId = getSetting("integration.netatmo_hc.client_id")!;
const clientSecret = getSetting("integration.netatmo_hc.client_secret")!;

const eqRow = db.prepare("SELECT id, zone_id FROM equipments WHERE type = 'main_energy_meter'").get() as
  | { id: string; zone_id: string }
  | undefined;
if (!eqRow) { console.error("No main_energy_meter found."); process.exit(1); }
const equipmentId = eqRow.id;
const zoneId = eqRow.zone_id ?? "00000000-0000-0000-0000-000000000001";

const BRIDGE_ID = "00:04:74:44:d3:7c";
db.close();

// ============================================================
// Netatmo auth
// ============================================================

let tokens: { refreshToken: string; accessToken: string; expiresAt: number };
try {
  tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
} catch {
  console.error(`Cannot read ${TOKEN_PATH}.`);
  process.exit(1);
}

const NETATMO_BASE = "https://api.netatmo.com";

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
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  tokens.accessToken = data.access_token;
  tokens.refreshToken = data.refresh_token;
  tokens.expiresAt = Date.now() + data.expires_in * 1000;
  // Persist refreshed tokens
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  return refreshAccessToken();
}

// ============================================================
// Helpers
// ============================================================

const HALF_HOUR = 1800;
const hourlyBucket = `${influxBucket}-energy-hourly`;
const dailyBucket = `${influxBucket}-energy-daily`;

const influxClient = new InfluxDB({ url: influxUrl, token: influxToken });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate array of date strings from start to end (inclusive). */
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ============================================================
// Process one day
// ============================================================

async function processDay(targetDate: string): Promise<{ raw: number; hourly: number; dailyWh: number }> {
  const dayStart = new Date(targetDate + "T00:00:00");
  const dayStartTs = Math.floor(dayStart.getTime() / 1000);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

  // 1. Fetch from Netatmo
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    device_id: BRIDGE_ID,
    module_id: BRIDGE_ID,
    type: "sum_energy_buy_from_grid$1,sum_energy_buy_from_grid$2,sum_energy_self_consumption",
    scale: "30min",
    optimize: "false",
    date_begin: String(dayStartTs),
    date_end: String(dayEndTs),
  });

  const res = await fetch(`${NETATMO_BASE}/api/getmeasure?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getMeasure failed for ${targetDate}: ${await res.text()}`);
  const data = (await res.json()) as { body: Record<string, (number | null)[]> };

  // 2. Parse Netatmo data and accumulate by hour
  // (skip raw bucket write — retention policy would reject old data anyway)
  const hourlyTotals = new Map<number, number>();
  let rawCount = 0;

  const timestamps = Object.keys(data.body).sort();
  for (const ts of timestamps) {
    const tsNum = parseInt(ts, 10);
    if (tsNum >= dayEndTs) continue;

    const values = data.body[ts]!;
    const totalWh = (values[0] ?? 0) + (values[1] ?? 0) + (values[2] ?? 0);
    if (totalWh <= 0) continue;

    const alignedTs = Math.floor(tsNum / HALF_HOUR) * HALF_HOUR;
    rawCount++;

    // Accumulate for hourly aggregation
    const hourTs = Math.floor(alignedTs / 3600) * 3600;
    hourlyTotals.set(hourTs, (hourlyTotals.get(hourTs) ?? 0) + totalWh);
  }

  if (hourlyTotals.size === 0) {
    return { raw: 0, hourly: 0, dailyWh: 0 };
  }

  // 3. Delete existing hourly + daily for this day (idempotent)
  await Promise.all([
    fetch(`${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${hourlyBucket}`, {
      method: "POST",
      headers: { Authorization: `Token ${influxToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        start: dayStart.toISOString(),
        stop: dayEnd.toISOString(),
        predicate: `_measurement="equipment_data" AND equipmentId="${equipmentId}"`,
      }),
    }),
    fetch(`${influxUrl}/api/v2/delete?org=${influxOrg}&bucket=${dailyBucket}`, {
      method: "POST",
      headers: { Authorization: `Token ${influxToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        start: dayStart.toISOString(),
        stop: dayEnd.toISOString(),
        predicate: `_measurement="equipment_data" AND equipmentId="${equipmentId}"`,
      }),
    }),
  ]);

  // 4. Write hourly points
  const hourlyWriteApi = influxClient.getWriteApi(influxOrg, hourlyBucket, "s", {
    batchSize: 100,
    flushInterval: 5000,
    maxRetries: 3,
  });

  let dayTotal = 0;
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
    dayTotal += totalWh;
  }
  await hourlyWriteApi.close();

  // 5. Write daily point
  const dailyWriteApi = influxClient.getWriteApi(influxOrg, dailyBucket, "s", {
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 3,
  });

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

  return { raw: rawCount, hourly: hourlyTotals.size, dailyWh: dayTotal };
}

// ============================================================
// Main
// ============================================================

async function run(): Promise<void> {
  const dates = dateRange(startDate, endDate);
  console.log(`\nEnergy backfill: ${dates.length} days (${startDate} → ${endDate})`);
  console.log(`Equipment: ${equipmentId}, zoneId: ${zoneId}`);
  console.log(`Buckets: raw=${influxBucket}, hourly=${hourlyBucket}, daily=${dailyBucket}\n`);

  let totalRaw = 0;
  let totalDays = 0;
  let skippedDays = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    try {
      const result = await processDay(date);
      if (result.raw === 0) {
        process.stdout.write(`  ${date}  —  no data\n`);
        skippedDays++;
      } else {
        process.stdout.write(
          `  ${date}  ✓  ${result.raw} raw, ${result.hourly} hourly, daily=${(result.dailyWh / 1000).toFixed(2)} kWh\n`,
        );
        totalRaw += result.raw;
        totalDays++;
      }

      // Rate limit: Netatmo allows ~50 req/10s, be conservative
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  ... pause 3s (rate limit) ...\n`);
        await sleep(3000);
      }
    } catch (err) {
      console.error(`  ${date}  ✗  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone! ${totalDays} days processed, ${skippedDays} skipped (no data), ${totalRaw} total raw points.`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
