/**
 * Energy backfill — fetches 6 months of historical energy data from Netatmo API
 * and writes directly to the energy-hourly InfluxDB bucket.
 *
 * Runs once on first setup (no `energy.legrand.lastBackfill` setting).
 * Requires an Equipment bound to the virtual device with historized energy binding.
 * If no Equipment exists yet, backfill is skipped and retried on next restart.
 */

import { Point } from "@influxdata/influxdb-client";
import type { WriteApi } from "@influxdata/influxdb-client";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { NetatmoBridge } from "./netatmo-bridge.js";
import type { InfluxClient } from "../../history/influx-client.js";

const BACKFILL_MONTHS = 6;
const API_DELAY_MS = 200; // Rate limiting pause between API calls

export interface BackfillDeps {
  bridge: NetatmoBridge;
  bridgeId: string;
  influxClient: InfluxClient;
  settingsManager: SettingsManager;
  equipmentManager: EquipmentManager;
  logger: Logger;
}

/**
 * Backfill energy data if not already done.
 * Finds the Equipment bound to the energy virtual device, then writes hourly data.
 */
export async function backfillEnergyIfNeeded(deps: BackfillDeps): Promise<void> {
  const { settingsManager, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "energy-backfill" });

  const lastBackfill = settingsManager.get("energy.legrand.lastBackfill");
  if (lastBackfill) {
    logger.debug({ lastBackfill }, "Energy backfill already completed — skipping");
    return;
  }

  // Find the Equipment bound to the energy consumption virtual device
  const equipmentId = findEnergyEquipmentId(deps, logger);
  if (!equipmentId) {
    logger.info(
      "No Equipment bound to energy virtual device — backfill deferred until Equipment is created",
    );
    return;
  }

  logger.info({ equipmentId }, "Starting energy backfill (first run)");

  try {
    await runBackfill(deps, equipmentId, logger);
    settingsManager.set("energy.legrand.lastBackfill", new Date().toISOString());
    logger.info("Energy backfill completed successfully");
  } catch (err) {
    logger.error({ err }, "Energy backfill failed — will retry on next restart");
  }
}

/**
 * Find the Equipment ID for the main energy meter.
 */
function findEnergyEquipmentId(deps: BackfillDeps, logger: Logger): string | null {
  const { equipmentManager } = deps;
  const equipments = equipmentManager.getAll();
  const meter = equipments.find((eq) => eq.type === "main_energy_meter");
  if (!meter) {
    logger.debug("No main_energy_meter equipment found");
    return null;
  }
  return meter.id;
}

async function runBackfill(deps: BackfillDeps, equipmentId: string, logger: Logger): Promise<void> {
  const { bridge, bridgeId, influxClient } = deps;

  const writeApi = influxClient.getEnergyHourlyWriteApi();
  if (!writeApi) {
    logger.warn("InfluxDB not connected — cannot backfill");
    return;
  }

  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - BACKFILL_MONTHS);
  startDate.setHours(0, 0, 0, 0);

  let totalPoints = 0;
  let currentDate = new Date(startDate);

  while (currentDate < now) {
    const dayStart = Math.floor(currentDate.getTime() / 1000);
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEnd = Math.floor(nextDay.getTime() / 1000);

    try {
      const res = await bridge.getMeasure(
        bridgeId,
        bridgeId,
        "sum_energy_buy_from_grid$1,sum_energy_buy_from_grid$2,sum_energy_self_consumption",
        "1hour",
        dayStart,
      );

      const timestamps = Object.keys(res.body).sort();
      for (const ts of timestamps) {
        const tsNum = parseInt(ts, 10);
        if (tsNum >= dayEnd) continue; // Don't spill into next day

        const values = res.body[ts];
        const buyGrid1 = values[0] ?? 0;
        const buyGrid2 = values[1] ?? 0;
        const selfConso = values[2] ?? 0;
        const totalConsumption = buyGrid1 + buyGrid2 + selfConso;

        if (totalConsumption <= 0) continue;

        writeEnergyPoint(writeApi, equipmentId, totalConsumption, tsNum);
        totalPoints++;
      }
    } catch (err) {
      logger.warn(
        { err, date: currentDate.toISOString().slice(0, 10) },
        "Backfill day failed — continuing",
      );
    }

    // Rate limiting
    await sleep(API_DELAY_MS);
    currentDate = nextDay;
  }

  // Flush remaining writes
  try {
    await writeApi.close();
  } catch (err) {
    logger.warn({ err }, "Error flushing backfill writes");
  }

  logger.info({ totalPoints, months: BACKFILL_MONTHS }, "Backfill data written to energy-hourly");
}

function writeEnergyPoint(
  writeApi: WriteApi,
  equipmentId: string,
  valueWh: number,
  timestampSec: number,
): void {
  const point = new Point("equipment_data")
    .tag("equipmentId", equipmentId)
    .tag("alias", "energy")
    .tag("category", "energy")
    .tag("type", "number")
    .floatField("value_number", valueWh)
    .timestamp(timestampSec);
  writeApi.writePoint(point);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
