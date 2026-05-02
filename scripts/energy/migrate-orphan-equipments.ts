/**
 * Migrate orphan `equipmentId` tags in InfluxDB energy buckets.
 *
 * After deleting equipments from Sowel (SQLite), their historical points in
 * `sowel-energy-hourly` and `sowel-energy-daily` remain tagged with the old
 * UUIDs and become invisible to the energy aggregator. This script rewrites
 * those points with the UUID of a replacement equipment so the history
 * appears continuous in the UI.
 *
 * Process per (oldId → newId) pair, per bucket:
 *   1. Query all points with equipmentId == oldId
 *   2. Rewrite same points with equipmentId == newId (other tags preserved)
 *   3. Delete the old points (predicate: equipmentId == oldId)
 *
 * Default mode is dry-run (only counts). Pass `--apply` to execute.
 *
 *   # CLI form (preferred — environment-agnostic):
 *   npx tsx scripts/energy/migrate-orphan-equipments.ts \
 *     --pair OLD_UUID:NEW_UUID:label \
 *     --pair OLD_UUID:NEW_UUID:label \
 *     [--apply]
 *
 *   # Or edit the DEFAULT_MIGRATIONS const below for repeated reuse.
 *
 * SAFETY: Take an InfluxDB backup before running with --apply.
 *   docker exec <influx-container> influx backup /tmp/backup --token <admin-token>
 *   # or, lighter, dump only the energy buckets via Flux to CSV.
 */

import Database from "better-sqlite3";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

interface Migration {
  oldId: string;
  newId: string;
  label: string;
}

/**
 * Reference / fallback migrations. Used when no `--pair` arg is provided.
 * Edit for the target environment, or pass `--pair OLD:NEW:label` instead.
 */
const DEFAULT_MIGRATIONS: Migration[] = [];

const BUCKETS = ["sowel-energy-hourly", "sowel-energy-daily"];
const APPLY = process.argv.includes("--apply");

function parseCliPairs(): Migration[] {
  const out: Migration[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--pair") continue;
    const raw = process.argv[i + 1];
    if (!raw) throw new Error("--pair flag requires OLD:NEW[:label]");
    const [oldId, newId, ...rest] = raw.split(":");
    if (!oldId || !newId) throw new Error(`Invalid --pair value: ${raw}`);
    out.push({ oldId, newId, label: rest.join(":") || `${oldId} → ${newId}` });
  }
  return out;
}

const MIGRATIONS = parseCliPairs();
if (MIGRATIONS.length === 0) MIGRATIONS.push(...DEFAULT_MIGRATIONS);
if (MIGRATIONS.length === 0) {
  console.error("No migrations provided. Pass --pair OLD:NEW[:label] (repeatable) or edit DEFAULT_MIGRATIONS.");
  process.exit(1);
}

// ── Load Influx config from local Sowel SQLite settings ────────────────

const db = new Database("data/sowel.db", { readonly: true });
function getSetting(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  if (!row) throw new Error(`Setting not found: ${key}`);
  return row.value;
}
const INFLUX_URL = getSetting("history.influx.url");
const INFLUX_TOKEN = getSetting("history.influx.token");
const INFLUX_ORG = getSetting("history.influx.org");
db.close();

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });

// ── Read / write helpers ───────────────────────────────────────────────

interface PointRow {
  time: Date;
  measurement: string;
  field: string;
  value: number;
  tags: Record<string, string>;
}

const RESERVED_COLUMNS = new Set([
  "_time", "_value", "_field", "_measurement", "_start", "_stop", "result", "table",
]);

async function readPoints(bucket: string, oldId: string): Promise<PointRow[]> {
  const flux = `
from(bucket: "${bucket}")
  |> range(start: 2020-01-01T00:00:00Z)
  |> filter(fn: (r) => r.equipmentId == "${oldId}")
`;
  const out: PointRow[] = [];
  const queryApi = influx.getQueryApi(INFLUX_ORG);
  return await new Promise<PointRow[]>((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row) as Record<string, unknown>;
        const tags: Record<string, string> = {};
        for (const col of tableMeta.columns) {
          if (RESERVED_COLUMNS.has(col.label)) continue;
          const v = o[col.label];
          if (v !== undefined && v !== null && v !== "") tags[col.label] = String(v);
        }
        out.push({
          time: new Date(String(o._time)),
          measurement: String(o._measurement),
          field: String(o._field),
          value: Number(o._value),
          tags,
        });
      },
      error: (err) => reject(err),
      complete: () => resolve(out),
    });
  });
}

async function writePoints(bucket: string, points: PointRow[], newId: string): Promise<void> {
  const writeApi = influx.getWriteApi(INFLUX_ORG, bucket, "ns");
  for (const p of points) {
    const point = new Point(p.measurement);
    for (const [k, v] of Object.entries(p.tags)) {
      point.tag(k, k === "equipmentId" ? newId : v);
    }
    point.floatField(p.field, p.value);
    point.timestamp(p.time);
    writeApi.writePoint(point);
  }
  await writeApi.close();
}

async function deleteByEquipmentId(bucket: string, oldId: string): Promise<void> {
  const res = await fetch(
    `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(bucket)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${INFLUX_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: "2020-01-01T00:00:00Z",
        stop: new Date().toISOString(),
        predicate: `_measurement="equipment_data" AND equipmentId="${oldId}"`,
      }),
    },
  );
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text()}`);
}

// ── Main ───────────────────────────────────────────────────────────────

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Influx: ${INFLUX_URL}  org=${INFLUX_ORG}\n`);

  let totalRead = 0;
  let totalWritten = 0;
  for (const m of MIGRATIONS) {
    console.log(`=== ${m.label} ===`);
    console.log(`    ${m.oldId} → ${m.newId}`);
    for (const bucket of BUCKETS) {
      const points = await readPoints(bucket, m.oldId);
      totalRead += points.length;
      console.log(`    ${bucket.padEnd(22)} ${points.length.toString().padStart(6)} points`);
      if (points.length === 0) continue;
      if (APPLY) {
        await writePoints(bucket, points, m.newId);
        await deleteByEquipmentId(bucket, m.oldId);
        totalWritten += points.length;
        console.log(`        → rewritten with new id, old points deleted`);
      }
    }
    console.log();
  }

  console.log(`Total points read: ${totalRead}`);
  if (APPLY) {
    console.log(`Total points migrated: ${totalWritten}`);
    console.log("\nDone. Reload the energy pages to see merged history.");
  } else {
    console.log("\nDry-run complete. Re-run with --apply to execute the migration.");
    console.log("Tip: take an InfluxDB backup before --apply.");
  }
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
