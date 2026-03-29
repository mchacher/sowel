/**
 * NetatmoPoller — Energy-only polling (NLPC meters).
 *
 * On each poll:
 * 1. GET /api/homesdata → discover NLPC meters → capture bridgeId
 * 2. GET /api/getmeasure → fetch 30-min energy windows
 */

import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { NetatmoBridge } from "./netatmo-bridge.js";
import { METER_TYPES, mapModuleToDiscovered, extractStatusPayload } from "./netatmo-types.js";

const DEFAULT_POLL_INTERVAL_MS = 300_000;
const ENERGY_LOOKBACK_S = 6 * 3600;

export class NetatmoPoller {
  private bridge: NetatmoBridge;
  private deviceManager: DeviceManager;
  private equipmentManager: EquipmentManager;
  private eventBus: EventBus;
  private logger: Logger;
  private homeId: string;
  private pollIntervalMs: number;

  private interval: ReturnType<typeof setInterval> | null = null;
  private staggerTimeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private pollFailed = false;
  private lastPollAt: string | null = null;

  /** Map of moduleId → friendlyName for NLPC meters. */
  private moduleNames = new Map<string, string>();
  /** Bridge ID discovered from NLPC meters. */
  private bridgeId: string | null = null;
  /** Friendly name of the main NLPC meter (receives bridge-level energy). */
  private mainMeterName: string | null = null;
  /** High-water mark for energy window timestamps. */
  private lastEmittedWindowTs = 0;

  constructor(
    bridge: NetatmoBridge,
    deviceManager: DeviceManager,
    equipmentManager: EquipmentManager,
    _settingsManager: SettingsManager,
    eventBus: EventBus,
    homeId: string,
    logger: Logger,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.equipmentManager = equipmentManager;
    this.eventBus = eventBus;
    this.homeId = homeId;
    this.logger = logger.child({ module: "legrand-hc-poller" });
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(pollOffset = 0): Promise<void> {
    this.logger.info(
      { homeId: this.homeId, intervalMs: this.pollIntervalMs, pollOffset },
      "Starting Legrand Energy poller",
    );
    await this.poll();
    const startInterval = () => {
      this.interval = setInterval(() => {
        this.poll().catch((err) => this.logger.error({ err }, "Energy poll failed"));
      }, this.pollIntervalMs);
    };
    if (pollOffset > 0) {
      this.staggerTimeout = setTimeout(startInterval, pollOffset);
    } else {
      startInterval();
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.staggerTimeout) {
      clearTimeout(this.staggerTimeout);
      this.staggerTimeout = null;
    }
    this.logger.info("Legrand Energy poller stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    if (!this.lastPollAt) return null;
    return { lastPollAt: this.lastPollAt, intervalMs: this.pollIntervalMs };
  }

  isPollHealthy(): boolean {
    return !this.pollFailed;
  }

  getBridgeId(): string | null {
    return this.bridgeId;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      this.lastPollAt = new Date().toISOString();

      // Phase 1: discover NLPC meters + capture bridgeId
      await this.discoverMeters();

      // Phase 2: poll status for NLPC meters (power readings)
      await this.pollMeterStatus().catch((err) =>
        this.logger.warn({ err }, "Meter status poll failed"),
      );

      // Phase 3: poll bridge-level energy data
      await this.pollEnergyMeters().catch((err) =>
        this.logger.warn({ err }, "Energy meters poll failed"),
      );

      if (this.pollFailed) {
        this.pollFailed = false;
        this.eventBus.emit({
          type: "system.alarm.resolved",
          alarmId: "poll-fail:netatmo_hc",
          source: "Legrand Energy",
          message: "Communication rétablie",
        });
      }
    } catch (err) {
      this.logger.error({ err }, "Energy poll cycle failed");
      if (!this.pollFailed) {
        this.pollFailed = true;
        this.eventBus.emit({
          type: "system.alarm.raised",
          alarmId: "poll-fail:netatmo_hc",
          level: "error",
          source: "Legrand Energy",
          message: `Poll en échec : ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      this.polling = false;
    }
  }

  /** Discover NLPC meters from homesdata and capture bridgeId. */
  private async discoverMeters(): Promise<void> {
    const homesData = await this.bridge.getHomesData();
    const home = homesData.body.homes.find((h) => h.id === this.homeId);
    if (!home) throw new Error(`Home ${this.homeId} not found`);

    const modules = home.modules ?? [];
    const activeIds = new Set<string>();

    for (const mod of modules) {
      if (!METER_TYPES.has(mod.type)) continue;

      // Capture bridge ID from first NLPC with a bridge
      if (mod.bridge && !this.bridgeId) {
        this.bridgeId = mod.bridge;
        this.logger.info({ moduleId: mod.id, bridge: mod.bridge }, "Bridge ID captured");
      }

      // First NLPC with a bridge = main meter
      if (!this.mainMeterName && mod.bridge) {
        this.mainMeterName = mod.name || mod.id;
        this.logger.info({ name: this.mainMeterName }, "Main energy meter identified");
      }

      const discovered = mapModuleToDiscovered(mod, this.homeId);
      this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", discovered);

      const name = mod.name || mod.id;
      this.moduleNames.set(mod.id, name);
      activeIds.add(name);
    }

    // Only remove stale NLPC devices (not control devices which are now managed by legrand_control plugin)
    this.deviceManager.removeStaleDevices("netatmo_hc", activeIds);
  }

  /** Poll homestatus for NLPC power readings. */
  private async pollMeterStatus(): Promise<void> {
    const status = await this.bridge.getHomeStatus(this.homeId);
    const modules = status.body.home.modules;

    for (const mod of modules) {
      const friendlyName = this.moduleNames.get(mod.id);
      if (!friendlyName) continue;
      const payload = extractStatusPayload(mod);
      this.deviceManager.updateDeviceData("netatmo_hc", friendlyName, payload);
    }
  }

  /** Poll bridge-level energy data (30-min granularity). */
  private async pollEnergyMeters(): Promise<void> {
    if (!this.bridgeId || !this.mainMeterName) return;

    try {
      const nowTs = Math.floor(Date.now() / 1000);
      const HALF_HOUR = 1800;
      const lookbackStart = Math.floor((nowTs - ENERGY_LOOKBACK_S) / HALF_HOUR) * HALF_HOUR;

      let newBuckets = 0;
      let lastBucketEnergy = 0;
      let lastBucketProduction = 0;

      for (let windowStart = lookbackStart; windowStart < nowTs; windowStart += HALF_HOUR) {
        const windowEnd = windowStart + HALF_HOUR;
        if (windowEnd > nowTs) break;

        const { consumption, production, autoconso, injection } = await this.queryEnergyWindow(
          windowStart,
          windowEnd,
        );
        if (consumption <= 0 && production <= 0) continue;

        if (consumption > 0) {
          this.deviceManager.updateDeviceData(
            "netatmo_hc",
            this.mainMeterName!,
            { energy: consumption },
            windowStart,
          );
        }

        if (production > 0) {
          const prodDeviceName = this.resolveProductionDeviceName();
          if (prodDeviceName) {
            this.deviceManager.updateDeviceData(
              "netatmo_hc",
              prodDeviceName,
              { energy: production, autoconso, injection },
              windowStart,
            );
          }
        }

        if (windowStart > this.lastEmittedWindowTs) {
          newBuckets++;
          lastBucketEnergy = consumption;
          lastBucketProduction = production;
          this.lastEmittedWindowTs = windowStart;
        }
      }

      if (lastBucketEnergy > 0) {
        this.deviceManager.updateDeviceData("netatmo_hc", this.mainMeterName!, {
          demand_30min: Math.round(lastBucketEnergy * 2),
        });
      }

      if (newBuckets > 0) {
        this.logger.debug(
          {
            newBuckets,
            demand30minW: Math.round(lastBucketEnergy * 2),
            lastProdWh: lastBucketProduction,
          },
          "Energy poll: new 30-min buckets processed",
        );
      }
    } catch (err) {
      this.logger.warn({ err }, "Failed to poll bridge-level energy data");
    }
  }

  private async queryEnergyWindow(
    windowStart: number,
    windowEnd: number,
  ): Promise<{ consumption: number; production: number; autoconso: number; injection: number }> {
    const ENERGY_TYPES =
      "sum_energy_buy_from_grid$1,sum_energy_buy_from_grid$2,sum_energy_self_consumption,sum_energy_resell_to_grid";

    const res = await this.bridge.getMeasure(
      this.bridgeId!,
      this.bridgeId!,
      ENERGY_TYPES,
      "5min",
      windowStart,
      windowEnd,
    );

    const timestamps = Object.keys(res.body);
    if (timestamps.length === 0)
      return { consumption: 0, production: 0, autoconso: 0, injection: 0 };

    let consumption = 0;
    let autoconso = 0;
    let injection = 0;
    for (const ts of timestamps) {
      const values = res.body[ts];
      const hp = values[0] ?? 0;
      const hc = values[1] ?? 0;
      const selfConso = values[2] ?? 0;
      const resellToGrid = values[3] ?? 0;
      consumption += hp + hc + selfConso;
      autoconso += selfConso;
      injection += resellToGrid;
    }
    return { consumption, production: autoconso + injection, autoconso, injection };
  }

  private resolveProductionDeviceName(): string | null {
    const eq = this.equipmentManager.getAll().find((e) => e.type === "energy_production_meter");
    if (!eq) return null;
    const binding = this.equipmentManager
      .getDataBindingsWithValues(eq.id)
      .find((b) => b.alias === "energy");
    return binding?.deviceName ?? null;
  }
}
