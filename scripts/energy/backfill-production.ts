#!/usr/bin/env npx tsx
/**
 * Backfill solar production data (energy, autoconso, injection) from Netatmo into InfluxDB.
 * Queries 5-min granularity, aggregates into 30-min windows, writes to raw + hourly + daily buckets.
 *
 * Usage:
 *   npx tsx scripts/energy/backfill-production.ts 2026-02-15 2026-03-15
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

const DB_PATH = "./data/sowel.db";
const TOKEN_PATH = "./data/netatmo-tokens.json";

const startDate = process.argv[2];
const endDate = process.argv[3];

if (!startDate || !endDate) {
  console.error("Usage: npx tsx scripts/energy/backfill-production.ts YYYY-MM-DD YYYY-MM-DD");
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

const eqRow = db.prepare("SELECT id, zone_id FROM equipments WHERE type = 'energy_production_meter'").get() as
  | { id: string; zone_id: string }
  | undefined;
if (!eqRow) { console.error("No energy_production_meter found."); process.exit(1); }
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
const rawBucket = influxBucket;
const hourlyBucket = `${influxBucket}-energy-hourly`;
const dailyBucket = `${influxBucket}-energy-daily`;

const influxClient = new InfluxDB({ url: influxUrl, token: influxToken });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

interface WindowData {
  production: number;
  autoconso: number;
  injection: number;
}

// ============================================================
// Process one day
// ============================================================

async function processDay(targetDate: string): Promise<{ windows: number; hourly: number; dailyWh: number }> {
  const dayStart = new Date(targetDate + "T00:00:00");
  const dayStartTs = Math.floor(dayStart.getTime() / 1000);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

  // 1. Fetch 5-min production data from Netatmo
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    device_id: BRIDGE_ID,
    module_id: BRIDGE_ID,
    type: "sum_energy_self_consumption,sum_energy_resell_to_grid",
    scale: "5min",
    optimize: "false",
    date_begin: String(dayStartTs),
    date_end: String(dayEndTs),
  });

  const res = await fetch(`${NETATMO_BASE}/api/getmeasure?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getMeasure failed for ${targetDate}: ${await res.text()}`);
  const data = (await res.json()) as { body: Record<string, (number | null)[]> };

  // 2. Aggregate 5-min buckets into 30-min windows
  const windowMap = new Map<number, WindowData>();
  const timestamps = Object.keys(data.body).sort();

  for (const ts of timestamps) {
    const tsNum = parseInt(ts, 10);
    if (tsNum >= dayEndTs) continue;

    const values = data.body[ts]!;
    const selfConso = values[0] ?? 0;
    const resellToGrid = values[1] ?? 0;
    const production = selfConso + resellToGrid;
    if (production <= 0) continue;

    const windowTs = Math.floor(tsNum / HALF_HOUR) * HALF_HOUR;
    const existing = windowMap.get(windowTs) ?? { production: 0, autoconso: 0, injection: 0 };
    existing.production += production;
    existing.autoconso += selfConso;
    existing.injection += resellToGrid;
    windowMap.set(windowTs, existing);
  }

  if (windowMap.size === 0) {
    return { windows: 0, hourly: 0, dailyWh: 0 };
  }

  // 3. Write raw 30-min points — skip if older than 7 days (raw bucket retention)
  const RAW_RETENTION_S = 7 * 86400;
  const nowTs = Math.floor(Date.now() / 1000);
  if (dayStartTs > nowTs - RAW_RETENTION_S) {
    const rawWriteApi = influxClient.getWriteApi(influxOrg, rawBucket, "s", {
      batchSize: 200,
      flushInterval: 5000,
      maxRetries: 3,
    });

    for (const [windowTs, w] of windowMap) {
      for (const [alias, value] of [
        ["energy", w.production],
        ["autoconso", w.autoconso],
        ["injection", w.injection],
      ] as const) {
        const point = new Point("equipment_data")
          .tag("equipmentId", equipmentId)
          .tag("alias", alias)
          .tag("category", "energy")
          .tag("type", "number")
          .tag("zoneId", zoneId)
          .floatField("value_number", value)
          .timestamp(windowTs);
        rawWriteApi.writePoint(point);
      }
    }
    await rawWriteApi.close();
  }

  // 4. Aggregate into hourly
  const hourlyMap = new Map<number, WindowData>();
  for (const [windowTs, w] of windowMap) {
    const hourTs = Math.floor(windowTs / 3600) * 3600;
    const existing = hourlyMap.get(hourTs) ?? { production: 0, autoconso: 0, injection: 0 };
    existing.production += w.production;
    existing.autoconso += w.autoconso;
    existing.injection += w.injection;
    hourlyMap.set(hourTs, existing);
  }

  // 5. Delete existing hourly + daily for this day, then write
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

  const hourlyWriteApi = influxClient.getWriteApi(influxOrg, hourlyBucket, "s", {
    batchSize: 200,
    flushInterval: 5000,
    maxRetries: 3,
  });

  let dayTotal = 0;
  let dayAutoconso = 0;
  let dayInjection = 0;

  for (const [hourTs, h] of hourlyMap) {
    for (const [alias, value] of [
      ["energy", h.production],
      ["autoconso", h.autoconso],
      ["injection", h.injection],
    ] as const) {
      const point = new Point("equipment_data")
        .tag("equipmentId", equipmentId)
        .tag("alias", alias)
        .tag("category", "energy")
        .tag("type", "number")
        .tag("zoneId", zoneId)
        .floatField("value_number", value)
        .timestamp(hourTs);
      hourlyWriteApi.writePoint(point);
    }
    dayTotal += h.production;
    dayAutoconso += h.autoconso;
    dayInjection += h.injection;
  }
  await hourlyWriteApi.close();

  // 6. Write daily point
  const dailyWriteApi = influxClient.getWriteApi(influxOrg, dailyBucket, "s", {
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 3,
  });

  for (const [alias, value] of [
    ["energy", dayTotal],
    ["autoconso", dayAutoconso],
    ["injection", dayInjection],
  ] as const) {
    const point = new Point("equipment_data")
      .tag("equipmentId", equipmentId)
      .tag("alias", alias)
      .tag("category", "energy")
      .tag("type", "number")
      .tag("zoneId", zoneId)
      .floatField("value_number", value)
      .timestamp(dayStartTs);
    dailyWriteApi.writePoint(point);
  }
  await dailyWriteApi.close();

  return { windows: windowMap.size, hourly: hourlyMap.size, dailyWh: dayTotal };
}

// ============================================================
// Main
// ============================================================

async function run(): Promise<void> {
  const dates = dateRange(startDate, endDate);
  console.log(`\nProduction backfill: ${dates.length} days (${startDate} → ${endDate})`);
  console.log(`Equipment: ${equipmentId} (energy_production_meter), zoneId: ${zoneId}`);
  console.log(`Buckets: raw=${rawBucket}, hourly=${hourlyBucket}, daily=${dailyBucket}\n`);

  let totalWindows = 0;
  let totalDays = 0;
  let skippedDays = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    try {
      const result = await processDay(date);
      if (result.windows === 0) {
        process.stdout.write(`  ${date}  —  no production\n`);
        skippedDays++;
      } else {
        process.stdout.write(
          `  ${date}  ✓  ${result.windows} windows, ${result.hourly} hourly, daily=${(result.dailyWh / 1000).toFixed(2)} kWh\n`,
        );
        totalWindows += result.windows;
        totalDays++;
      }

      // Rate limit: Netatmo allows ~50 req/10s
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  ... pause 3s (rate limit) ...\n`);
        await sleep(3000);
      }
    } catch (err) {
      console.error(`  ${date}  ✗  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone! ${totalDays} days with production, ${skippedDays} skipped, ${totalWindows} total 30-min windows.`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
