#!/usr/bin/env npx tsx
/**
 * Spec 158 — print the arbiter daily metrics over a date range.
 *
 * Reads SQLite directly (read-only), so it works against a restored backup
 * with no running instance:
 *
 *   npx tsx scripts/energy/arbiter-metrics.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--db path]
 *
 * Defaults to the last 30 days of ./data/sowel.db.
 */

import Database from "better-sqlite3";

interface LoadRow {
  day: string;
  equipment_id: string;
  grants: number;
  revokes: number;
  short_cycles: number;
  granted_s: number;
  pending_s: number;
  unmanaged_s: number;
  suspended_s: number;
}

interface HomeRow {
  day: string;
  export_wh: number;
  import_wh: number;
  idle_claimable_export_wh: number;
  samples: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)} h`;
}

function kwh(wh: number): string {
  return `${(wh / 1000).toFixed(2)} kWh`;
}

const dbPath = arg("db") ?? "./data/sowel.db";
const to = arg("to") ?? localDay(new Date());
const from =
  arg("from") ??
  (() => {
    const d = new Date(`${to}T12:00:00`);
    d.setDate(d.getDate() - 29);
    return localDay(d);
  })();

const db = new Database(dbPath, { readonly: true });

const loads = db
  .prepare(
    "SELECT day, equipment_id, grants, revokes, short_cycles, granted_s, pending_s," +
      " unmanaged_s, suspended_s FROM arbiter_daily_load_metrics" +
      " WHERE day >= ? AND day <= ? ORDER BY day ASC",
  )
  .all(from, to) as LoadRow[];

const home = db
  .prepare(
    "SELECT day, export_wh, import_wh, idle_claimable_export_wh, samples" +
      " FROM arbiter_daily_home_metrics WHERE day >= ? AND day <= ? ORDER BY day ASC",
  )
  .all(from, to) as HomeRow[];

const names = new Map<string, string>();
for (const row of db.prepare("SELECT id, name FROM equipments").all() as {
  id: string;
  name: string;
}[]) {
  names.set(row.id, row.name);
}
db.close();

console.log(`\nArbiter metrics — ${from} to ${to}  (${dbPath})`);

if (loads.length === 0 && home.length === 0) {
  console.log("\n  No data for this range.");
  console.log("  The rollup writes one row per day per declared load; a fresh install,");
  console.log("  a disabled arbiter or a range before the feature shipped all read empty.\n");
  process.exit(0);
}

// ── Home totals ─────────────────────────────────────────────
const totals = home.reduce(
  (acc, d) => ({
    exportWh: acc.exportWh + d.export_wh,
    importWh: acc.importWh + d.import_wh,
    idleWh: acc.idleWh + d.idle_claimable_export_wh,
    samples: acc.samples + d.samples,
  }),
  { exportWh: 0, importWh: 0, idleWh: 0, samples: 0 },
);

// ~288 samples per full day. A day well below that was a day the instance
// was down, and every figure derived from it understates reality.
const expectedSamples = home.length * 288;
const coverage = expectedSamples > 0 ? (totals.samples / expectedSamples) * 100 : 0;

console.log(`\n  Days with data     ${home.length}`);
console.log(`  Sample coverage    ${coverage.toFixed(0)} %`);
console.log(`  Exported           ${kwh(totals.exportWh)}`);
console.log(`  Imported           ${kwh(totals.importWh)}`);
console.log(`  Exported while a declared load was idle   ${kwh(totals.idleWh)}   (estimate)`);

// ── Per-load breakdown ──────────────────────────────────────
interface Agg {
  grants: number;
  revokes: number;
  shortCycles: number;
  grantedS: number;
  pendingS: number;
  unmanagedS: number;
  suspendedS: number;
  days: Set<string>;
}

const byLoad = new Map<string, Agg>();
for (const row of loads) {
  let agg = byLoad.get(row.equipment_id);
  if (!agg) {
    agg = {
      grants: 0,
      revokes: 0,
      shortCycles: 0,
      grantedS: 0,
      pendingS: 0,
      unmanagedS: 0,
      suspendedS: 0,
      days: new Set(),
    };
    byLoad.set(row.equipment_id, agg);
  }
  agg.grants += row.grants;
  agg.revokes += row.revokes;
  agg.shortCycles += row.short_cycles;
  agg.grantedS += row.granted_s;
  agg.pendingS += row.pending_s;
  agg.unmanagedS += row.unmanaged_s;
  agg.suspendedS += row.suspended_s;
  agg.days.add(row.day);
}

console.log("\n  Per load\n");
const header = [
  "load".padEnd(22),
  "grants".padStart(7),
  "short".padStart(6),
  "rate".padStart(6),
  "/day".padStart(6),
  "granted".padStart(9),
  "pending".padStart(9),
  "unmanaged".padStart(10),
].join(" ");
console.log(`  ${header}`);
console.log(`  ${"-".repeat(header.length)}`);

for (const [id, agg] of [...byLoad].sort((a, b) => b[1].shortCycles - a[1].shortCycles)) {
  const name = (names.get(id) ?? id).slice(0, 22);
  const rate = agg.grants > 0 ? `${((agg.shortCycles / agg.grants) * 100).toFixed(0)} %` : "-";
  const perDay = agg.days.size > 0 ? (agg.shortCycles / agg.days.size).toFixed(1) : "-";
  console.log(
    [
      `  ${name.padEnd(22)}`,
      String(agg.grants).padStart(7),
      String(agg.shortCycles).padStart(6),
      rate.padStart(6),
      perDay.padStart(6),
      hours(agg.grantedS).padStart(9),
      hours(agg.pendingS).padStart(9),
      hours(agg.unmanagedS).padStart(10),
    ].join(" "),
  );
}

console.log(
  "\n  short = grants revoked inside (minOnS + releaseHoldS): the load started",
);
console.log("          on a surplus that did not hold. Lower is better.\n");
