#!/usr/bin/env npx tsx
/**
 * One-off backfill of the Sowel raw bucket from the Shelly Pro 3EM's own
 * minute-resolution archive (`EM1Data.GetData` RPC).
 *
 * Use case: Sowel was offline / not yet running for some hours of the day,
 * but the Shelly was already measuring. The device stores ~60 days of
 * minute-resolution data in flash and exposes it via HTTP RPC.
 *
 * The script:
 *   1. Reads tariff config + main_energy_meter / energy_production_meter
 *      equipment IDs from SQLite.
 *   2. Queries Shelly RPC for channels 0 (grid) and 1 (solar) over the
 *      requested window, paginated.
 *   3. Pairs grid + solar per minute, computes household-semantic values
 *      (energy = household, energy_hp/hc, autoconso, injection).
 *   4. Upserts into the raw Influx bucket on (equipmentId, alias, ts).
 *   5. Clears the affected hours in <bucket>-energy-hourly so the
 *      downsample task regenerates them.
 *
 * Default mode: dry-run. Pass --apply to execute.
 *
 * Usage (run inside the Sowel container so it shares Influx + SQLite):
 *   docker exec -w /app sowel npx -y tsx scripts/energy/backfill-shelly-archive.ts \
 *     --shelly-host 192.168.0.69 \
 *     [--since 2026-05-03T00:00:00Z] \
 *     [--until 2026-05-03T07:00:00Z] \
 *     [--apply]
 *
 * SAFETY:
 * - This is essentially the same pattern as
 *   `recompute-household-energy.ts` but reading from the Shelly RPC.
 * - Take an InfluxDB backup before --apply on a non-trivial window.
 * - The script will NOT touch hours the device's archive doesn't hold
 *   (gaps in `data_blocks` are skipped with a warn).
 */
import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

// ── CLI ───────────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v) throw new Error(`${name} requires a value`);
  return v;
}

const APPLY = process.argv.includes("--apply");
const SHELLY_HOST = getArg("--shelly-host") ?? "192.168.0.69";

function defaultSince(): string {
  // Local midnight, expressed in UTC. With TZ=Europe/Paris in CEST that's
  // yesterday 22:00Z; in CET, yesterday 23:00Z.
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
const SINCE_ISO = getArg("--since") ?? defaultSince();
const UNTIL_ARG = getArg("--until");
const SINCE_S = Math.floor(new Date(SINCE_ISO).getTime() / 1000);

// Pair grid/solar within this many seconds (records share the same minute boundary).
const MATCH_WINDOW_S = 30;

// ── SQLite settings + equipments ──────────────────────────────────────

const DB_PATH = "./data/sowel.db";
const db = new Database(DB_PATH, { readonly: true });

function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function getInfluxConfig(): {
  url: string;
  token: string;
  org: string;
  bucket: string;
} {
  const fromEnv = {
    url: process.env["INFLUX_URL"],
    token: process.env["INFLUX_TOKEN"],
    org: process.env["INFLUX_ORG"],
    bucket: process.env["INFLUX_BUCKET"],
  };
  return {
    url: fromEnv.url ?? getSetting("history.influx.url") ?? "",
    token: fromEnv.token ?? getSetting("history.influx.token") ?? "",
    org: fromEnv.org ?? getSetting("history.influx.org") ?? "",
    bucket: fromEnv.bucket ?? getSetting("history.influx.bucket") ?? "",
  };
}

const { url: INFLUX_URL, token: INFLUX_TOKEN, org: INFLUX_ORG, bucket: RAW_BUCKET } =
  getInfluxConfig();
if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !RAW_BUCKET) {
  console.error("InfluxDB not configured (set env vars or settings).");
  process.exit(1);
}
const HOURLY_BUCKET = `${RAW_BUCKET}-energy-hourly`;

interface EqRow {
  id: string;
  zone_id: string;
}

function findEquipment(type: string): EqRow | null {
  const row = db
    .prepare(
      "SELECT id, zone_id FROM equipments WHERE type = ? AND enabled = 1 LIMIT 1",
    )
    .get(type) as EqRow | undefined;
  return row ?? null;
}

const grid = findEquipment("main_energy_meter");
const prod = findEquipment("energy_production_meter");
if (!grid || !prod) {
  console.error(
    `Missing required equipment(s): grid=${!!grid} prod=${!!prod}.`,
  );
  process.exit(1);
}

// ── Tariff classifier (inlined — mirrors src/energy/tariff-classifier.ts) ──

interface TariffSlot {
  start: string;
  end: string;
  tariff: "hp" | "hc";
}
interface DaySchedule {
  days: number[];
  slots: TariffSlot[];
}
interface TariffConfig {
  schedules: DaySchedule[];
  prices: { hp: number; hc: number };
}

const tariffRaw = getSetting("energy.tariff");
const tariff: TariffConfig | null = tariffRaw ? JSON.parse(tariffRaw) : null;
if (!tariff) {
  console.warn(
    "No tariff schedule configured — hp/hc will both be 0 except hp=household.",
  );
}

function parseTimeMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function classifyHpHc(totalWh: number, epochS: number): { hp: number; hc: number } {
  if (!tariff) return { hp: totalWh, hc: 0 };
  const d = new Date(epochS * 1000);
  const day = d.getDay();
  const sched = tariff.schedules.find((s) => s.days.includes(day));
  if (!sched || sched.slots.length === 0) return { hp: totalWh, hc: 0 };

  const startMin = d.getHours() * 60 + d.getMinutes();
  const endMin = startMin + 30;
  let hp = 0;
  let hc = 0;
  for (const slot of sched.slots) {
    const ss = parseTimeMinutes(slot.start);
    let se = parseTimeMinutes(slot.end);
    if (se === 0) se = 1440;
    const ranges: Array<[number, number]> =
      se <= ss ? [[ss, 1440], [0, se]] : [[ss, se]];
    for (const [rs, re] of ranges) {
      const overlap = Math.max(0, Math.min(endMin, re) - Math.max(startMin, rs));
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

db.close();

// ── Shelly RPC client ─────────────────────────────────────────────────

interface MinuteRecord {
  ts: number;
  totalActEnergy: number;
  totalActRetEnergy: number;
}

interface DataBlock {
  ts: number;
  period: number;
  records: number;
}

async function getRecords(channelId: number): Promise<DataBlock[]> {
  const url = `http://${SHELLY_HOST}/rpc/EM1Data.GetRecords?id=${channelId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GetRecords failed (${res.status})`);
  const json = (await res.json()) as { data_blocks: DataBlock[] };
  return json.data_blocks ?? [];
}

async function getDataPaginated(
  channelId: number,
  startTs: number,
  endTs: number,
): Promise<MinuteRecord[]> {
  const out: MinuteRecord[] = [];
  let cursor = startTs;
  while (cursor < endTs) {
    const url = `http://${SHELLY_HOST}/rpc/EM1Data.GetData?id=${channelId}&ts=${cursor}&end_ts=${endTs}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GetData failed (${res.status})`);
    const json = (await res.json()) as {
      keys: string[];
      data: Array<{ ts: number; period: number; values: number[][] }>;
      next_record_ts?: number;
    };
    if (!json.data || json.data.length === 0) break;
    const fwdIdx = json.keys.indexOf("total_act_energy");
    const revIdx = json.keys.indexOf("total_act_ret_energy");
    for (const block of json.data) {
      const baseTs = block.ts;
      block.values.forEach((row, i) => {
        out.push({
          ts: baseTs + i * block.period,
          totalActEnergy: row[fwdIdx],
          totalActRetEnergy: row[revIdx],
        });
      });
    }
    if (!json.next_record_ts || json.next_record_ts <= cursor) break;
    cursor = json.next_record_ts;
  }
  return out;
}

// ── Pairing + computation ─────────────────────────────────────────────

interface PairedTick {
  epochS: number;
  signedGrid: number;
  solar: number;
  household: number;
  autoconso: number;
  injection: number;
  hp: number;
  hc: number;
}

function pairAndCompute(
  gridRecs: MinuteRecord[],
  solarRecs: MinuteRecord[],
): PairedTick[] {
  const solarByMinute = new Map<number, MinuteRecord>();
  for (const r of solarRecs) solarByMinute.set(Math.floor(r.ts / 60), r);

  const out: PairedTick[] = [];
  for (const g of gridRecs) {
    const minute = Math.floor(g.ts / 60);
    const candidate =
      solarByMinute.get(minute) ??
      solarByMinute.get(minute - 1) ??
      solarByMinute.get(minute + 1);
    if (!candidate) continue;
    if (Math.abs(candidate.ts - g.ts) > MATCH_WINDOW_S) continue;

    const signedGrid = g.totalActEnergy - g.totalActRetEnergy;
    // Solar: signed delta to match what the live plugin emits as `energy` on
    // the production equipment. Reverse on a production CT is the inverter's
    // standby draw and must be subtracted.
    const solar = candidate.totalActEnergy - candidate.totalActRetEnergy;
    const injection = Math.max(0, -signedGrid);
    const autoconso = Math.max(0, solar - injection);
    const household = Math.max(0, signedGrid) + autoconso;
    const ts = Math.max(g.ts, candidate.ts);
    const split = classifyHpHc(household, ts);
    out.push({
      epochS: ts,
      signedGrid,
      solar,
      household,
      autoconso,
      injection,
      hp: split.hp,
      hc: split.hc,
    });
  }
  return out;
}

// ── Influx I/O ────────────────────────────────────────────────────────

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });

function buildPoint(args: {
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

async function writeBatch(points: Point[]): Promise<void> {
  const writeApi = influx.getWriteApi(INFLUX_ORG, RAW_BUCKET, "s", {
    batchSize: 500,
    flushInterval: 10_000,
    maxRetries: 3,
  });
  for (const p of points) writeApi.writePoint(p);
  await writeApi.close();
}

async function clearHourly(startIso: string, stopIso: string): Promise<void> {
  const aliases = ["energy", "energy_hp", "energy_hc", "autoconso", "injection"];
  for (const alias of aliases) {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(HOURLY_BUCKET)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start: startIso,
          stop: stopIso,
          predicate: `_measurement="equipment_data" AND alias="${alias}"`,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Hourly delete (alias=${alias}) failed: ${res.status} ${await res.text()}`,
      );
    }
    console.log(`  Hourly bucket: cleared alias=${alias} in [${startIso}, ${stopIso}]`);
  }
}

// ── Auto-detect --until to avoid double-count with live points ────────

async function detectUntil(): Promise<{ untilS: number; untilIso: string; reason: string }> {
  if (UNTIL_ARG) {
    const s = Math.floor(new Date(UNTIL_ARG).getTime() / 1000);
    return { untilS: s, untilIso: UNTIL_ARG, reason: "explicit --until" };
  }
  // Query the earliest existing grid `energy` point in [since, now] in raw bucket.
  const queryApi = influx.getQueryApi(INFLUX_ORG);
  const flux = `from(bucket: "${RAW_BUCKET}")
  |> range(start: ${SINCE_ISO}, stop: ${new Date().toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r._field == "value_number")
  |> filter(fn: (r) => r.equipmentId == "${grid!.id}")
  |> filter(fn: (r) => r.alias == "energy")
  |> sort(columns: ["_time"])
  |> limit(n: 1)`;
  const firstTs = await new Promise<number | null>((resolve, reject) => {
    let found: number | null = null;
    queryApi.queryRows(flux, {
      next(row, meta) {
        const o = meta.toObject(row) as { _time?: string };
        if (o._time && found === null) {
          found = Math.floor(new Date(o._time).getTime() / 1000);
        }
      },
      error: (err) => reject(err),
      complete: () => resolve(found),
    });
  });
  if (firstTs === null) {
    const nowS = Math.floor(Date.now() / 1000);
    return { untilS: nowS, untilIso: new Date(nowS * 1000).toISOString(), reason: "no existing live data → bound = now" };
  }
  return {
    untilS: firstTs,
    untilIso: new Date(firstTs * 1000).toISOString(),
    reason: `auto: first existing grid energy point at ${new Date(firstTs * 1000).toISOString()} — backfill stops here to avoid overlap`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log("=== Backfill from Shelly archive ===");
  console.log(`Mode      : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Shelly    : ${SHELLY_HOST}`);

  const { untilS: UNTIL_S, untilIso: UNTIL_ISO, reason: untilReason } = await detectUntil();
  if (SINCE_S >= UNTIL_S) {
    console.error(`Invalid range: ${SINCE_ISO} → ${UNTIL_ISO} (${untilReason})`);
    process.exit(1);
  }
  console.log(`Range     : ${SINCE_ISO}  →  ${UNTIL_ISO}    [${untilReason}]`);
  console.log(`Influx    : ${INFLUX_URL} org=${INFLUX_ORG} bucket=${RAW_BUCKET}`);
  console.log(`Grid      : ${grid.id}`);
  console.log(`Prod      : ${prod.id}`);
  console.log(`Tariff    : ${tariff ? "loaded" : "not configured (hp=household, hc=0)"}\n`);

  console.log("Reading data_blocks from Shelly...");
  const [gridBlocks, solarBlocks] = await Promise.all([getRecords(0), getRecords(1)]);
  console.log(
    `  channel 0 (grid):  ${gridBlocks.length} block(s), ${gridBlocks.reduce((a, b) => a + b.records, 0)} records total`,
  );
  console.log(
    `  channel 1 (solar): ${solarBlocks.length} block(s), ${solarBlocks.reduce((a, b) => a + b.records, 0)} records total`,
  );

  // Window intersect each block with [since, until], fetch, paginate.
  function intersectBlocks(blocks: DataBlock[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const b of blocks) {
      const blockStart = b.ts;
      const blockEnd = b.ts + b.period * b.records;
      const start = Math.max(blockStart, SINCE_S);
      const end = Math.min(blockEnd, UNTIL_S);
      if (end > start) out.push([start, end]);
    }
    return out;
  }
  const gridRanges = intersectBlocks(gridBlocks);
  const solarRanges = intersectBlocks(solarBlocks);

  console.log(`\nFetching grid records...`);
  const gridRecs: MinuteRecord[] = [];
  for (const [s, e] of gridRanges) {
    const recs = await getDataPaginated(0, s, e);
    gridRecs.push(...recs);
    console.log(`  [${new Date(s * 1000).toISOString()} → ${new Date(e * 1000).toISOString()}] ${recs.length} records`);
  }

  console.log(`Fetching solar records...`);
  const solarRecs: MinuteRecord[] = [];
  for (const [s, e] of solarRanges) {
    const recs = await getDataPaginated(1, s, e);
    solarRecs.push(...recs);
    console.log(`  [${new Date(s * 1000).toISOString()} → ${new Date(e * 1000).toISOString()}] ${recs.length} records`);
  }

  const ticks = pairAndCompute(gridRecs, solarRecs);
  console.log(`\nPaired ticks: ${ticks.length}\n`);

  if (ticks.length === 0) {
    console.log("Nothing to do — no paired records in the requested window.");
    return;
  }

  const totals = ticks.reduce(
    (acc, t) => ({
      gridImport: acc.gridImport + Math.max(0, t.signedGrid),
      gridExport: acc.gridExport + Math.max(0, -t.signedGrid),
      solar: acc.solar + t.solar,
      household: acc.household + t.household,
      autoconso: acc.autoconso + t.autoconso,
      injection: acc.injection + t.injection,
      hp: acc.hp + t.hp,
      hc: acc.hc + t.hc,
    }),
    { gridImport: 0, gridExport: 0, solar: 0, household: 0, autoconso: 0, injection: 0, hp: 0, hc: 0 },
  );

  const fmt = (wh: number) => `${(wh / 1000).toFixed(3)} kWh`;
  console.log("Totals over range:");
  console.log(`  grid import : ${fmt(totals.gridImport)}`);
  console.log(`  grid export : ${fmt(totals.gridExport)}`);
  console.log(`  solar       : ${fmt(totals.solar)}`);
  console.log(`  household   : ${fmt(totals.household)}   (= grid_import + autoconso)`);
  console.log(`  autoconso   : ${fmt(totals.autoconso)}`);
  console.log(`  injection   : ${fmt(totals.injection)}`);
  console.log(`  household HP/HC: hp=${fmt(totals.hp)}  hc=${fmt(totals.hc)}\n`);

  console.log("Sample ticks (first 3, last 3):");
  const sample = [...ticks.slice(0, 3), ...ticks.slice(-3)];
  for (const t of sample) {
    console.log(
      `  ${new Date(t.epochS * 1000).toISOString()}  grid=${t.signedGrid.toFixed(0).padStart(6)}  solar=${t.solar.toFixed(0).padStart(6)}  → hh=${t.household.toFixed(0).padStart(5)}  ac=${t.autoconso.toFixed(0).padStart(4)}  inj=${t.injection.toFixed(0).padStart(4)}  hp=${t.hp.toFixed(0).padStart(5)}  hc=${t.hc.toFixed(0).padStart(4)}`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to write to Influx.");
    return;
  }

  console.log(`Writing ${ticks.length * 6} points to ${RAW_BUCKET}...`);
  const points: Point[] = [];
  for (const t of ticks) {
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy", value: t.household, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy_hp", value: t.hp, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy_hc", value: t.hc, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: prod.id, zoneId: prod.zone_id, alias: "energy", value: t.solar, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: prod.id, zoneId: prod.zone_id, alias: "autoconso", value: t.autoconso, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: prod.id, zoneId: prod.zone_id, alias: "injection", value: t.injection, epochS: t.epochS }));
  }
  await writeBatch(points);
  console.log("  Raw bucket points written.\n");

  console.log(`Clearing affected aliases in ${HOURLY_BUCKET}...`);
  await clearHourly(SINCE_ISO, UNTIL_ISO);
  console.log();

  console.log("=== Done ===");
  console.log("Trigger the hourly downsample task manually to refresh charts immediately.");
})().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
