#!/usr/bin/env npx tsx
/**
 * Recompute household-semantic energy points after a Shelly-driven deployment
 * that ran without `SelfConsumptionWriter`.
 *
 * Context: between v1.5.1 deploy (Shelly drives `main_energy_meter` +
 * `energy_production_meter`) and v1.5.2 (which introduces
 * `SelfConsumptionWriter`), the raw bucket holds:
 *
 *   grid `energy`   = signed gridΔ Wh   (positive = imported, negative = exported)
 *   prod `energy`   = solar production Wh
 *   prod `autoconso`= NOT WRITTEN
 *   prod `injection`= NOT WRITTEN
 *   grid `energy_hp/hc` = TariffClassifier(signed gridΔ)   ← wrong semantic
 *
 * The legacy Netatmo-era charts assume:
 *   grid `energy`   = TOTAL household (grid + autoconso)
 *   grid `energy_hp/hc` = TariffClassifier(household)
 *   prod `autoconso`= max(0, solarΔ - injection)
 *   prod `injection`= max(0, -gridΔ)
 *
 * This script reads the raw points, pairs grid/solar by minute bucket,
 * computes the household semantic, and overwrites or inserts the right
 * points in the raw bucket. After --apply, it deletes the affected hours
 * from `<bucket>-energy-hourly` so the downsample task regenerates them
 * on its next run.
 *
 * Default mode: dry-run (only counts + sample). Pass --apply to execute.
 *
 * Usage:
 *   npx tsx scripts/energy/recompute-household-energy.ts \
 *     [--since 2026-05-03T07:00:00Z] \
 *     [--until 2026-05-03T18:30:00Z] \
 *     [--apply]
 *
 *   --since defaults to today 09:00 local time.
 *   --until defaults to now.
 *
 * SAFETY: Take an InfluxDB backup before --apply. The raw bucket's TTL is
 * 7d so anything older than that is gone anyway and out of scope.
 */
import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

// ── CLI ───────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v) throw new Error(`${name} requires a value`);
  return v;
}

function defaultSinceISO(): string {
  // Today 09:00 local time
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

const SINCE_ISO = getArg("--since") ?? defaultSinceISO();
const UNTIL_ISO = getArg("--until") ?? new Date().toISOString();
const SINCE_S = Math.floor(new Date(SINCE_ISO).getTime() / 1000);
const UNTIL_S = Math.floor(new Date(UNTIL_ISO).getTime() / 1000);
if (!Number.isFinite(SINCE_S) || !Number.isFinite(UNTIL_S) || SINCE_S >= UNTIL_S) {
  console.error(`Invalid range: ${SINCE_ISO} → ${UNTIL_ISO}`);
  process.exit(1);
}

// Pair grid/solar within this many seconds.
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
    `Missing required equipment(s): grid=${!!grid} prod=${!!prod}. Need both main_energy_meter and energy_production_meter to recompute.`,
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

/**
 * Mirrors TariffClassifier.classify (30-min window assumption). Per-minute
 * points still go through this — the prorata is consistent with what the
 * runtime writer does, so the chart stays aligned.
 */
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

// ── Influx I/O ────────────────────────────────────────────────────────

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = influx.getQueryApi(INFLUX_ORG);

interface RawPoint {
  epochS: number;
  value: number;
}

async function readEnergy(equipmentId: string): Promise<RawPoint[]> {
  const flux = `from(bucket: "${RAW_BUCKET}")
  |> range(start: ${SINCE_ISO}, stop: ${UNTIL_ISO})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r._field == "value_number")
  |> sort(columns: ["_time"])`;
  const out: RawPoint[] = [];
  return await new Promise<RawPoint[]>((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, meta) {
        const o = meta.toObject(row) as Record<string, unknown>;
        const t = o._time ? Math.floor(new Date(String(o._time)).getTime() / 1000) : NaN;
        const v = Number(o._value);
        if (Number.isFinite(t) && Number.isFinite(v)) out.push({ epochS: t, value: v });
      },
      error: (err) => reject(err),
      complete: () => resolve(out),
    });
  });
}

interface PairedTick {
  epochS: number;
  grid: number;
  solar: number;
  household: number;
  autoconso: number;
  injection: number;
  hp: number;
  hc: number;
}

function pairAndCompute(
  gridPts: RawPoint[],
  solarPts: RawPoint[],
): PairedTick[] {
  // Bucket solar points by minute for fast lookup.
  const solarByMinute = new Map<number, RawPoint>();
  for (const p of solarPts) solarByMinute.set(Math.floor(p.epochS / 60), p);

  const out: PairedTick[] = [];
  for (const g of gridPts) {
    const minute = Math.floor(g.epochS / 60);
    // Try same minute first, then ±1 minute as fallback.
    const candidate =
      solarByMinute.get(minute) ??
      solarByMinute.get(minute - 1) ??
      solarByMinute.get(minute + 1);
    if (!candidate) continue;
    if (Math.abs(candidate.epochS - g.epochS) > MATCH_WINDOW_S) continue;

    const grid = g.value;
    const solar = candidate.value;
    const injection = Math.max(0, -grid);
    const autoconso = Math.max(0, solar - injection);
    const household = Math.max(0, grid) + autoconso;
    const ts = Math.max(g.epochS, candidate.epochS);
    const split = classifyHpHc(household, ts);
    out.push({
      epochS: ts,
      grid,
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

async function writeBatch(points: Point[]): Promise<void> {
  const writeApi = influx.getWriteApi(INFLUX_ORG, RAW_BUCKET, "s", {
    batchSize: 500,
    flushInterval: 10_000,
    maxRetries: 3,
  });
  for (const p of points) writeApi.writePoint(p);
  await writeApi.close();
}

async function deleteHourlyAffectedRange(): Promise<void> {
  // Delete only the recomputed alias families in the hourly bucket so the
  // downsample task regenerates them. Energy-only — leave other categories
  // alone in case unrelated equipments wrote to the same window.
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
          start: SINCE_ISO,
          stop: UNTIL_ISO,
          predicate: `_measurement="equipment_data" AND alias="${alias}"`,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Hourly delete (alias=${alias}) failed: ${res.status} ${await res.text()}`,
      );
    }
    console.log(`  Hourly bucket: cleared alias=${alias} in [${SINCE_ISO}, ${UNTIL_ISO}]`);
  }
}

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

// ── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log("=== Recompute household-semantic energy ===");
  console.log(`Mode      : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Range     : ${SINCE_ISO}  →  ${UNTIL_ISO}`);
  console.log(`Influx    : ${INFLUX_URL} org=${INFLUX_ORG} bucket=${RAW_BUCKET}`);
  console.log(`Grid      : ${grid.id}`);
  console.log(`Prod      : ${prod.id}`);
  console.log(`Tariff    : ${tariff ? "loaded" : "not configured (hp=household, hc=0)"}\n`);

  console.log("Reading raw points...");
  const [gridPts, solarPts] = await Promise.all([
    readEnergy(grid.id),
    readEnergy(prod.id),
  ]);
  console.log(`  grid  energy points: ${gridPts.length}`);
  console.log(`  solar energy points: ${solarPts.length}\n`);

  const ticks = pairAndCompute(gridPts, solarPts);
  console.log(`Paired ticks: ${ticks.length}\n`);

  if (ticks.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Aggregates for review
  const totals = ticks.reduce(
    (acc, t) => ({
      gridSum: acc.gridSum + t.grid,
      gridImport: acc.gridImport + Math.max(0, t.grid),
      gridExport: acc.gridExport + Math.max(0, -t.grid),
      solar: acc.solar + t.solar,
      household: acc.household + t.household,
      autoconso: acc.autoconso + t.autoconso,
      injection: acc.injection + t.injection,
      hp: acc.hp + t.hp,
      hc: acc.hc + t.hc,
    }),
    { gridSum: 0, gridImport: 0, gridExport: 0, solar: 0, household: 0, autoconso: 0, injection: 0, hp: 0, hc: 0 },
  );

  const fmt = (wh: number) => `${(wh / 1000).toFixed(3)} kWh`;
  console.log("Totals over range:");
  console.log(`  grid (signed)  : ${fmt(totals.gridSum)}   import=${fmt(totals.gridImport)}  export=${fmt(totals.gridExport)}`);
  console.log(`  solar          : ${fmt(totals.solar)}`);
  console.log(`  household      : ${fmt(totals.household)}   (= grid_import + autoconso)`);
  console.log(`  autoconso      : ${fmt(totals.autoconso)}`);
  console.log(`  injection      : ${fmt(totals.injection)}`);
  console.log(`  household HP/HC: hp=${fmt(totals.hp)}  hc=${fmt(totals.hc)}\n`);

  // Sample first/last 3 ticks
  console.log("Sample ticks (first 3, last 3):");
  const sample = [...ticks.slice(0, 3), ...ticks.slice(-3)];
  for (const t of sample) {
    console.log(
      `  ${new Date(t.epochS * 1000).toISOString()}  grid=${t.grid.toFixed(0).padStart(6)}  solar=${t.solar.toFixed(0).padStart(6)}  → hh=${t.household.toFixed(0).padStart(5)}  ac=${t.autoconso.toFixed(0).padStart(4)}  inj=${t.injection.toFixed(0).padStart(4)}  hp=${t.hp.toFixed(0).padStart(5)}  hc=${t.hc.toFixed(0).padStart(4)}`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to overwrite raw bucket and clear hourly.");
    console.log("Tip: take an InfluxDB backup first.");
    return;
  }

  // Build all points to write — same (measurement, tag set, ts) ⇒ upsert.
  console.log(`Writing ${ticks.length * 5} points to ${RAW_BUCKET}...`);
  const points: Point[] = [];
  for (const t of ticks) {
    // Grid-side overwrites
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy", value: t.household, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy_hp", value: t.hp, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: grid.id, zoneId: grid.zone_id, alias: "energy_hc", value: t.hc, epochS: t.epochS }));
    // Prod-side new aliases
    points.push(buildPoint({ equipmentId: prod.id, zoneId: prod.zone_id, alias: "autoconso", value: t.autoconso, epochS: t.epochS }));
    points.push(buildPoint({ equipmentId: prod.id, zoneId: prod.zone_id, alias: "injection", value: t.injection, epochS: t.epochS }));
  }
  await writeBatch(points);
  console.log("  Raw bucket points written.\n");

  console.log(`Clearing affected aliases in ${HOURLY_BUCKET} so the downsample task regenerates them...`);
  await deleteHourlyAffectedRange();
  console.log();

  console.log("=== Done ===");
  console.log("The hourly task runs every 1h with start=-7h — it will regenerate within the hour.");
  console.log("To force immediate refresh, you can run the task manually from the InfluxDB UI.");
})().catch((err) => {
  console.error("Recompute failed:", err);
  process.exit(1);
});
