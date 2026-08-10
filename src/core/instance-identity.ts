import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "./logger.js";
import type { SettingsManager } from "./settings-manager.js";

// ============================================================
// Issue #401 — restored-data guardrail
//
// A database restored from another deployment (a prod backup opened by a dev
// instance, a migration to new hardware) carries that deployment's brokers,
// OAuth grants, and notification channels. A fully armed instance on such
// data fights the origin deployment (MQTT clientId takeover loops, OAuth
// refresh-token rotation races — both observed on 2026-08-10).
//
// The instance id lives in the settings table and therefore travels inside
// backups; the marker file lives next to the database and describes THIS
// deployment. When they disagree, the data came from somewhere else: the
// engine starts inert (spec 124 gates) until an admin confirms the takeover
// in the UI, or SOWEL_TAKEOVER=1 pre-confirms it.
// ============================================================

export const INSTANCE_ID_SETTING = "system.instance_id";
export const INSTANCE_MARKER_FILE = ".instance-id";

export interface InstanceIdentity {
  instanceId: string;
  /** True when the database belongs to another deployment and no takeover was confirmed. */
  takeoverPending: boolean;
}

function markerPath(dataDir: string): string {
  return resolve(dataDir, INSTANCE_MARKER_FILE);
}

function readMarker(dataDir: string): string | null {
  try {
    if (!existsSync(markerPath(dataDir))) return null;
    const raw = readFileSync(markerPath(dataDir), "utf-8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the local deployment marker. Called on adoption and on takeover confirm. */
export function writeInstanceMarker(dataDir: string, instanceId: string): void {
  writeFileSync(markerPath(dataDir), instanceId + "\n");
}

export function resolveInstanceIdentity(opts: {
  settingsManager: SettingsManager;
  dataDir: string;
  /** SOWEL_TAKEOVER env flag — pre-confirms a takeover without the UI. */
  takeoverConfirmed: boolean;
  logger: Logger;
}): InstanceIdentity {
  const { settingsManager, dataDir, takeoverConfirmed } = opts;
  const logger = opts.logger.child({ module: "instance-identity" });

  const dbId = settingsManager.get(INSTANCE_ID_SETTING);
  const markerId = readMarker(dataDir);

  // First boot ever (including the first boot after upgrading to this
  // feature): mint an identity and adopt the data as ours. Pre-feature
  // backups restored before their origin ever minted an id are
  // indistinguishable from a first boot — documented limitation.
  if (!dbId) {
    const instanceId = randomUUID();
    settingsManager.set(INSTANCE_ID_SETTING, instanceId);
    writeInstanceMarker(dataDir, instanceId);
    logger.info({ instanceId }, "Instance identity minted");
    return { instanceId, takeoverPending: false };
  }

  if (markerId === dbId) {
    return { instanceId: dbId, takeoverPending: false };
  }

  // The database carries another deployment's identity (restored backup),
  // or the marker was lost. Either way this data is not provably ours.
  if (takeoverConfirmed) {
    writeInstanceMarker(dataDir, dbId);
    logger.warn(
      { instanceId: dbId, previousMarker: markerId },
      "Takeover confirmed via SOWEL_TAKEOVER — adopting restored data",
    );
    return { instanceId: dbId, takeoverPending: false };
  }

  logger.warn(
    { instanceId: dbId, localMarker: markerId },
    "TAKEOVER PENDING — this database was restored from another deployment. Outbound services stay inert until an admin confirms the takeover (UI banner or SOWEL_TAKEOVER=1).",
  );
  return { instanceId: dbId, takeoverPending: true };
}

/** Adopt the current database as this deployment's own (UI confirm path). */
export function confirmTakeover(opts: {
  settingsManager: SettingsManager;
  dataDir: string;
  logger: Logger;
}): void {
  const { settingsManager, dataDir } = opts;
  const logger = opts.logger.child({ module: "instance-identity" });
  const dbId = settingsManager.get(INSTANCE_ID_SETTING) ?? randomUUID();
  settingsManager.set(INSTANCE_ID_SETTING, dbId);
  writeInstanceMarker(dataDir, dbId);
  logger.warn({ instanceId: dbId }, "Takeover confirmed by admin — data adopted, restart required");
}
