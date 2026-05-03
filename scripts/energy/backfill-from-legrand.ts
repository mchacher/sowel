#!/usr/bin/env npx tsx
/**
 * Backfill missing days from the Legrand-Energy / Netatmo cloud API.
 *
 * Pulls 30-min `getmeasure` data for each requested day, aggregates by
 * hour, applies the same household-semantic mapping that
 * SelfConsumptionWriter writes for live data, and upserts hourly + daily
 * points in InfluxDB.
 *
 * Schema written (per requested day, on the Sowel equipments inherited
 * by the Shelly grid + solar after the orphan-migration):
 *
 *   on main_energy_meter (grid):
 *     energy     = household = HP_grid + HC_grid + autoconso
 *     energy_hp  = TariffClassifier(household, ts).hp
 *     energy_hc  = TariffClassifier(household, ts).hc
 *
 *   on energy_production_meter (solar):
 *     energy     = production = autoconso + injection
 *     autoconso  = autoconso (Netatmo `sum_energy_self_consumption`)
 *     injection  = injection (Netatmo `sum_energy_resell_to_grid`)
 *
 * Default mode: dry-run (per-day totals printed). Pass --apply to write.
 *
 * Usage (run inside the Sowel container so it shares Influx + SQLite):
 *   docker exec -w /app sowel npx -y tsx scripts/energy/backfill-from-legrand.ts \
 *     --days 2025-04-10,2025-04-12,2025-04-16 \
 *     [--apply]
 *
 *   # or --range
 *   docker exec -w /app sowel npx -y tsx scripts/energy/backfill-from-legrand.ts \
 *     --range 2025-04-18,2025-04-22 [--apply]
 *
 * SAFETY:
 * - Idempotent: deletes existing hourly+daily for the requested day on
 *   the matching equipmentId/alias set before writing.
 * - Skips days where Netatmo returns no data.
 * - Token refresh is automatic; new tokens are persisted to
 *   data/legrand-energy-tokens.json (same path the live plugin uses).
 */
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

// ── CLI ───────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function parseDayList(): string[] {
  const days = getArg("--days");
  if (days) return days.split(",").map((s) => s.trim()).filter(Boolean);
  const range = getArg("--range");
  if (range) {
    const [from, to] = range.split(",").map((s) => s.trim());
    if (!from || !to) throw new Error("--range expects YYYY-MM-DD,YYYY-MM-DD");
    const out: string[] = [];
    const d = new Date(from + "T12:00:00Z");
    const end = new Date(to + "T12:00:00Z");
    while (d <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }
  console.error("Pass --days YYYY-MM-DD[,YYYY-MM-DD,...] or --range YYYY-MM-DD,YYYY-MM-DD");
  process.exit(1);
}

const DAYS = parseDayList();

// ── SQLite settings + equipments ──────────────────────────────────────

const DB_PATH = "./data/sowel.db";
const TOKEN_PATH = "./data/legrand-energy-tokens.json";

const db = new Database(DB_PATH, { readonly: true });
const get = (key: string): string | undefined =>
  (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value;

// Env vars take precedence (matches the docker container layout where
// settings hold "localhost" but the actual hostname is the docker alias).
const INFLUX_URL = process.env["INFLUX_URL"] ?? get("history.influx.url")!;
const INFLUX_TOKEN = process.env["INFLUX_TOKEN"] ?? get("history.influx.token")!;
const INFLUX_ORG = process.env["INFLUX_ORG"] ?? get("history.influx.org")!;
const RAW_BUCKET = process.env["INFLUX_BUCKET"] ?? get("history.influx.bucket")!;
const HOURLY_BUCKET = `${RAW_BUCKET}-energy-hourly`;
const DAILY_BUCKET = `${RAW_BUCKET}-energy-daily`;
const CLIENT_ID = get("integration.legrand_energy.client_id")!;
const CLIENT_SECRET = get("integration.legrand_energy.client_secret")!;

interface EqRow { id: string; zone_id: string; }
const grid = db
  .prepare("SELECT id, zone_id FROM equipments WHERE type='main_energy_meter' AND enabled=1 LIMIT 1")
  .get() as EqRow | undefined;
const prod = db
  .prepare("SELECT id, zone_id FROM equipments WHERE type='energy_production_meter' AND enabled=1 LIMIT 1")
  .get() as EqRow | undefined;
if (!grid || !prod) {
  console.error(`Missing equipment(s): grid=${!!grid} prod=${!!prod}`);
  process.exit(1);
}

const tariffRaw = get("energy.tariff");
db.close();

// ── Tariff classifier (inlined) ───────────────────────────────────────

interface TariffSlot { start: string; end: string; tariff: "hp" | "hc"; }
interface DaySchedule { days: number[]; slots: TariffSlot[]; }
interface TariffConfig { schedules: DaySchedule[]; prices: { hp: number; hc: number }; }
const tariff: TariffConfig | null = tariffRaw ? JSON.parse(tariffRaw) : null;
if (!tariff) console.warn("No tariff schedule — hp will = household, hc = 0.");

const parseMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * 60-min window classifier (we aggregate by hour, not 30 min). Linear
 * prorata across slot transitions.
 */
function classifyHpHc(totalWh: number, epochS: number): { hp: number; hc: number } {
  if (!tariff) return { hp: totalWh, hc: 0 };
  const d = new Date(epochS * 1000);
  const sched = tariff.schedules.find((s) => s.days.includes(d.getDay()));
  if (!sched || sched.slots.length === 0) return { hp: totalWh, hc: 0 };
  const start = d.getHours() * 60 + d.getMinutes();
  const end = start + 60; // hourly window
  let hp = 0;
  let hc = 0;
  for (const slot of sched.slots) {
    const ss = parseMin(slot.start);
    let se = parseMin(slot.end);
    if (se === 0) se = 1440;
    const ranges: Array<[number, number]> = se <= ss ? [[ss, 1440], [0, se]] : [[ss, se]];
    for (const [rs, re] of ranges) {
      const overlap = Math.max(0, Math.min(end, re) - Math.max(start, rs));
      if (overlap > 0) {
        if (slot.tariff === "hp") hp += overlap;
        else hc += overlap;
      }
    }
  }
  const total = hp + hc;
  if (total === 0) return { hp: totalWh, hc: 0 };
  return {
    hp: Math.round((totalWh * hp) / total),
    hc: Math.round((totalWh * hc) / total),
  };
}

// ── Netatmo auth ──────────────────────────────────────────────────────

interface Tokens { accessToken: string; refreshToken: string; expiresAt: number; }
let tokens: Tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));

async function refresh(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const r = await fetch("https://api.netatmo.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${await r.text()}`);
  const d = (await r.json()) as { access_token: string; refresh_token: string; expires_in: number };
  tokens = {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + d.expires_in * 1000,
  };
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens.accessToken;
}

async function token(): Promise<string> {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  return refresh();
}

// ── Netatmo getmeasure ────────────────────────────────────────────────

let bridgeIdCache: string | null = null;
async function bridgeId(): Promise<string> {
  if (bridgeIdCache) return bridgeIdCache;
  const t = await token();
  const r = await fetch("https://api.netatmo.com/api/homesdata", {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new Error(`homesdata failed: ${await r.text()}`);
  const data = (await r.json()) as {
    body: { homes: Array<{ modules: Array<{ type: string; bridge?: string }> }> };
  };
  for (const h of data.body.homes) {
    for (const m of h.modules) {
      if (m.type === "NLPC" && m.bridge) {
        bridgeIdCache = m.bridge;
        return m.bridge;
      }
    }
  }
  throw new Error("No NLPC bridge found in homesdata.");
}

const ENERGY_TYPES =
  "sum_energy_buy_from_grid$1,sum_energy_buy_from_grid$2,sum_energy_self_consumption,sum_energy_resell_to_grid";

interface DaySlot {
  ts: number;
  hp_grid: number;
  hc_grid: number;
  autoconso: number;
  injection: number;
}

async function fetchDay(date: string): Promise<DaySlot[]> {
  // Use LOCAL midnight (no Z) so the day boundary matches what the
  // existing Sowel data uses. Container TZ=Europe/Paris.
  const dayStart = Math.floor(new Date(date + "T00:00:00").getTime() / 1000);
  const dayEnd = dayStart + 86400;
  const t = await token();
  const bid = await bridgeId();
  const params = new URLSearchParams({
    device_id: bid,
    module_id: bid,
    type: ENERGY_TYPES,
    scale: "30min",
    optimize: "false",
    date_begin: String(dayStart),
    date_end: String(dayEnd),
  });
  const r = await fetch(`https://api.netatmo.com/api/getmeasure?${params.toString()}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new Error(`getmeasure ${date} failed: ${r.status} ${await r.text()}`);
  const data = (await r.json()) as { body: Record<string, (number | null)[]> };
  const out: DaySlot[] = [];
  for (const [tsStr, values] of Object.entries(data.body)) {
    const ts = parseInt(tsStr, 10);
    if (ts >= dayEnd) continue;
    const slot: DaySlot = {
      ts: Math.floor(ts / 1800) * 1800, // align to 30-min boundary
      hp_grid: values[0] ?? 0,
      hc_grid: values[1] ?? 0,
      autoconso: values[2] ?? 0,
      injection: values[3] ?? 0,
    };
    if (slot.hp_grid + slot.hc_grid + slot.autoconso + slot.injection > 0) out.push(slot);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ── Influx I/O ────────────────────────────────────────────────────────

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });

function buildPoint(args: {
  bucket: string;
  equipmentId: string;
  zoneId: string;
  alias: string;
  value: number;
  epochS: number;
}): Point {
  return new Point("equipment_data")
    .tag("equipmentId", args.equipmentId)
    .tag("alias", args.alias)
    .tag("category", "energy")
    .tag("zoneId", args.zoneId)
    .tag("type", "number")
    .floatField("value_number", args.value)
    .timestamp(args.epochS);
}

async function deleteDay(bucket: string, equipmentId: string, aliases: string[], dayStart: Date, dayEnd: Date): Promise<void> {
  // InfluxDB delete API is INCLUSIVE on both bounds. Subtract 1 second
  // from stop so we don't sweep the next day's local-midnight entry.
  const stopEpochS = Math.floor(dayEnd.getTime() / 1000) - 1;
  const stopIso = new Date(stopEpochS * 1000).toISOString();
  for (const alias of aliases) {
    const r = await fetch(
      `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(bucket)}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          start: dayStart.toISOString(),
          stop: stopIso,
          predicate: `_measurement="equipment_data" AND equipmentId="${equipmentId}" AND alias="${alias}"`,
        }),
      },
    );
    if (!r.ok) throw new Error(`Delete failed (${bucket}/${alias}): ${r.status} ${await r.text()}`);
  }
}

interface DayResult {
  date: string;
  slotsFetched: number;
  household: number;
  production: number;
  autoconso: number;
  injection: number;
  hp: number;
  hc: number;
}

async function processDay(date: string): Promise<DayResult | null> {
  const slots = await fetchDay(date);
  if (slots.length === 0) return null;

  // Aggregate by hour
  const byHour = new Map<number, { household: number; production: number; autoconso: number; injection: number }>();
  for (const s of slots) {
    const hour = Math.floor(s.ts / 3600) * 3600;
    const acc = byHour.get(hour) ?? { household: 0, production: 0, autoconso: 0, injection: 0 };
    acc.household += s.hp_grid + s.hc_grid + s.autoconso;
    acc.production += s.autoconso + s.injection;
    acc.autoconso += s.autoconso;
    acc.injection += s.injection;
    byHour.set(hour, acc);
  }

  // Daily aggregates — use LOCAL midnight (matches existing data convention).
  let dHousehold = 0, dProd = 0, dAuto = 0, dInj = 0, dHp = 0, dHc = 0;
  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const dayStartTs = Math.floor(dayStart.getTime() / 1000);

  // Build per-hour points + classify
  const hourlyPoints: Point[] = [];
  for (const [hour, acc] of byHour.entries()) {
    const split = classifyHpHc(acc.household, hour);
    dHousehold += acc.household;
    dProd += acc.production;
    dAuto += acc.autoconso;
    dInj += acc.injection;
    dHp += split.hp;
    dHc += split.hc;
    hourlyPoints.push(
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy", value: acc.household, epochS: hour }),
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy_hp", value: split.hp, epochS: hour }),
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy_hc", value: split.hc, epochS: hour }),
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "energy", value: acc.production, epochS: hour }),
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "autoconso", value: acc.autoconso, epochS: hour }),
      buildPoint({ bucket: HOURLY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "injection", value: acc.injection, epochS: hour }),
    );
  }

  // Daily points
  const dailyPoints: Point[] = [
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy", value: dHousehold, epochS: dayStartTs }),
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy_hp", value: dHp, epochS: dayStartTs }),
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: grid!.id, zoneId: grid!.zone_id, alias: "energy_hc", value: dHc, epochS: dayStartTs }),
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "energy", value: dProd, epochS: dayStartTs }),
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "autoconso", value: dAuto, epochS: dayStartTs }),
    buildPoint({ bucket: DAILY_BUCKET, equipmentId: prod!.id, zoneId: prod!.zone_id, alias: "injection", value: dInj, epochS: dayStartTs }),
  ];

  if (APPLY) {
    // Idempotent: delete first
    const aliasGrid = ["energy", "energy_hp", "energy_hc"];
    const aliasProd = ["energy", "autoconso", "injection"];
    await deleteDay(HOURLY_BUCKET, grid!.id, aliasGrid, dayStart, dayEnd);
    await deleteDay(HOURLY_BUCKET, prod!.id, aliasProd, dayStart, dayEnd);
    await deleteDay(DAILY_BUCKET, grid!.id, aliasGrid, dayStart, dayEnd);
    await deleteDay(DAILY_BUCKET, prod!.id, aliasProd, dayStart, dayEnd);

    const wh = influx.getWriteApi(INFLUX_ORG, HOURLY_BUCKET, "s", { batchSize: 200, flushInterval: 5000, maxRetries: 3 });
    for (const p of hourlyPoints) wh.writePoint(p);
    await wh.close();

    const wd = influx.getWriteApi(INFLUX_ORG, DAILY_BUCKET, "s", { batchSize: 50, flushInterval: 5000, maxRetries: 3 });
    for (const p of dailyPoints) wd.writePoint(p);
    await wd.close();
  }

  return {
    date,
    slotsFetched: slots.length,
    household: dHousehold,
    production: dProd,
    autoconso: dAuto,
    injection: dInj,
    hp: dHp,
    hc: dHc,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log("=== Backfill from Legrand-Energy / Netatmo ===");
  console.log(`Mode      : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Days      : ${DAYS.length} (${DAYS[0]}${DAYS.length > 1 ? `, ..., ${DAYS[DAYS.length - 1]}` : ""})`);
  console.log(`Influx    : ${INFLUX_URL} org=${INFLUX_ORG}`);
  console.log(`Grid eq   : ${grid!.id}`);
  console.log(`Prod eq   : ${prod!.id}`);
  console.log(`Tariff    : ${tariff ? "loaded" : "not configured"}\n`);

  const fmt = (wh: number) => `${(wh / 1000).toFixed(2)} kWh`;
  const results: DayResult[] = [];
  let skipped = 0;

  for (let i = 0; i < DAYS.length; i++) {
    const day = DAYS[i];
    try {
      const r = await processDay(day);
      if (!r) {
        console.log(`  ${day}  —  no data`);
        skipped++;
      } else {
        console.log(
          `  ${day}  ✓  ${r.slotsFetched} slots, hh=${fmt(r.household).padStart(8)}  prod=${fmt(r.production).padStart(7)}  ac=${fmt(r.autoconso).padStart(7)}  inj=${fmt(r.injection).padStart(7)}  hp=${fmt(r.hp).padStart(7)}  hc=${fmt(r.hc).padStart(7)}`,
        );
        results.push(r);
      }
    } catch (err) {
      const cause = err instanceof Error && "cause" in err ? (err as { cause: unknown }).cause : null;
      const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : "";
      console.error(
        `  ${day}  ✗  ${err instanceof Error ? err.message : String(err)}${causeMsg ? ` (cause: ${causeMsg})` : ""}`,
      );
      if (err instanceof Error && err.stack) {
        console.error(err.stack.split("\n").slice(0, 4).join("\n"));
      }
    }
    if ((i + 1) % 10 === 0) {
      console.log("    (rate-limit pause 3s)");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log();
  console.log(
    `Summary: ${results.length} day(s) processed, ${skipped} skipped, ${DAYS.length - results.length - skipped} error(s)`,
  );
  if (results.length > 0) {
    const t = results.reduce(
      (a, r) => ({
        h: a.h + r.household, p: a.p + r.production, ac: a.ac + r.autoconso,
        inj: a.inj + r.injection, hp: a.hp + r.hp, hc: a.hc + r.hc,
      }),
      { h: 0, p: 0, ac: 0, inj: 0, hp: 0, hc: 0 },
    );
    console.log(
      `Totals : household=${fmt(t.h)}  prod=${fmt(t.p)}  ac=${fmt(t.ac)}  inj=${fmt(t.inj)}  hp=${fmt(t.hp)}  hc=${fmt(t.hc)}`,
    );
  }
  if (!APPLY && results.length > 0) {
    console.log("\nDry-run only. Re-run with --apply to write.");
  }
})().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
