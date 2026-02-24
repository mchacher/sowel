/**
 * NetatmoPoller — Periodic polling of Netatmo Home+Control API.
 *
 * On each poll:
 * 1. GET /api/homesdata → discover modules → upsertFromDiscovery
 * 2. GET /api/homestatus → read live values → updateDeviceData
 */

import type { Logger } from "../../core/logger.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { NetatmoBridge } from "./netatmo-bridge.js";
import {
  isSupportedModule,
  mapModuleToDiscovered,
  extractStatusPayload,
  METER_TYPES,
} from "./netatmo-types.js";

const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 min
const RAPID_POLL_FIRST_MS = 1_000; // first rapid poll 1s after order
const RAPID_POLL_INTERVAL_MS = 1_000; // then every 1s
const RAPID_POLL_DURATION_MS = 10_000; // stop after 10s

export class NetatmoPoller {
  private bridge: NetatmoBridge;
  private deviceManager: DeviceManager;
  private logger: Logger;
  private homeId: string;
  private pollIntervalMs: number;

  private interval: ReturnType<typeof setInterval> | null = null;
  private rapidInterval: ReturnType<typeof setInterval> | null = null;
  private rapidTimeout: ReturnType<typeof setTimeout> | null = null;
  private rapidStopTimeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private rapidPolling = false;

  /** Map of moduleId → friendlyName, built during discovery. */
  private moduleNames = new Map<string, string>();
  /** Energy meters: moduleId → { bridge, friendlyName } */
  private energyMeters = new Map<string, { bridge: string; friendlyName: string }>();

  constructor(
    bridge: NetatmoBridge,
    deviceManager: DeviceManager,
    homeId: string,
    logger: Logger,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.homeId = homeId;
    this.logger = logger.child({ module: "netatmo-poller" });
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    this.logger.info(
      { homeId: this.homeId, intervalMs: this.pollIntervalMs },
      "Starting Netatmo poller",
    );
    // Immediate first poll (awaited — data available at startup)
    await this.poll();
    this.interval = setInterval(() => {
      this.poll().catch((err) => this.logger.error({ err }, "Netatmo poll failed"));
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.stopRapidPoll();
    this.logger.info("Netatmo poller stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  /** Rapid status polling after an order: first at 1s, then every 1s, stops on confirmation or 10s timeout. */
  scheduleOnDemandPoll(expected?: { moduleId: string; param: string; value: unknown }): void {
    this.stopRapidPoll();
    this.logger.debug({ expected }, "Starting rapid status polling after order");

    const doRapidPoll = () => {
      if (this.rapidPolling || this.polling) return;
      this.rapidPolling = true;
      this.pollStatus(expected)
        .then((confirmed) => {
          if (confirmed) {
            this.logger.debug("Order confirmed by status poll, stopping rapid poll");
            this.stopRapidPoll();
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("429")) {
            this.logger.debug("Netatmo rapid poll skipped (rate-limited), will retry next tick");
          } else {
            this.logger.error({ err }, "Netatmo rapid poll failed");
          }
        })
        .finally(() => {
          this.rapidPolling = false;
        });
    };

    // First poll at 1s, then every 1s
    this.rapidTimeout = setTimeout(() => {
      doRapidPoll();
      this.rapidInterval = setInterval(doRapidPoll, RAPID_POLL_INTERVAL_MS);
    }, RAPID_POLL_FIRST_MS);

    // Hard stop after 10s
    this.rapidStopTimeout = setTimeout(() => {
      this.stopRapidPoll();
      this.logger.debug("Rapid status polling timed out");
    }, RAPID_POLL_DURATION_MS);
  }

  private stopRapidPoll(): void {
    if (this.rapidInterval) {
      clearInterval(this.rapidInterval);
      this.rapidInterval = null;
    }
    if (this.rapidTimeout) {
      clearTimeout(this.rapidTimeout);
      this.rapidTimeout = null;
    }
    if (this.rapidStopTimeout) {
      clearTimeout(this.rapidStopTimeout);
      this.rapidStopTimeout = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      // 1. Discover modules
      await this.discoverModules();

      // 2. Poll status
      await this.pollStatus();

      // 3. Poll energy meters (getMeasure)
      await this.pollEnergyMeters();
    } catch (err) {
      this.logger.error({ err }, "Netatmo poll cycle failed");
    } finally {
      this.polling = false;
    }
  }

  private async discoverModules(): Promise<void> {
    const homesData = await this.bridge.getHomesData();
    const home = homesData.body.homes.find((h) => h.id === this.homeId);
    if (!home) {
      this.logger.warn({ homeId: this.homeId }, "Home not found in homesdata");
      return;
    }

    const modules = home.modules ?? [];
    this.logger.info(
      { homeId: this.homeId, homeName: home.name, moduleCount: modules.length },
      "Netatmo discovery: scanning home",
    );

    if (modules.length === 0) {
      this.logger.warn("Netatmo discovery: no modules found in home — check API response");
      return;
    }

    const activeIds = new Set<string>();
    let supported = 0;

    for (const mod of modules) {
      if (!isSupportedModule(mod.type)) {
        this.logger.info(
          { type: mod.type, name: mod.name, id: mod.id },
          "Skipping unsupported module type",
        );
        continue;
      }

      const discovered = mapModuleToDiscovered(mod, this.homeId);
      this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", discovered);

      supported++;

      // Track moduleId → friendlyName for status updates
      const name = mod.name || mod.id;
      this.moduleNames.set(mod.id, name);
      activeIds.add(name); // sourceDeviceId = friendlyName

      if (METER_TYPES.has(mod.type) && mod.bridge) {
        this.energyMeters.set(mod.id, { bridge: mod.bridge, friendlyName: name });
        this.logger.info(
          { name, moduleId: mod.id, bridge: mod.bridge, type: mod.type },
          "Energy meter discovered",
        );
      }
    }

    this.logger.info(
      { total: modules.length, supported, skipped: modules.length - supported },
      "Netatmo discovery complete",
    );

    // Remove stale devices that no longer exist
    this.deviceManager.removeStaleDevices("netatmo_hc", activeIds);
  }

  private async pollStatus(expected?: {
    moduleId: string;
    param: string;
    value: unknown;
  }): Promise<boolean> {
    const status = await this.bridge.getHomeStatus(this.homeId);
    const modules = status.body.home.modules;
    let updated = 0;
    let confirmed = false;

    for (const mod of modules) {
      const friendlyName = this.moduleNames.get(mod.id);
      if (!friendlyName) continue; // Not a supported/discovered module

      const payload = extractStatusPayload(mod);
      if (Object.keys(payload).length === 0) continue;

      this.deviceManager.updateDeviceData("netatmo_hc", friendlyName, payload);
      updated++;

      if (expected && mod.id === expected.moduleId && payload[expected.param] === expected.value) {
        confirmed = true;
      }
    }

    this.logger.info({ updated, total: modules.length }, "Netatmo status poll complete");
    return confirmed;
  }

  /** Fetch cumulative energy for each energy meter via getMeasure. */
  private async pollEnergyMeters(): Promise<void> {
    if (this.energyMeters.size === 0) return;

    for (const [moduleId, { bridge, friendlyName }] of this.energyMeters) {
      try {
        // device_id = gateway, module_id = NLPC, no date_begin = oldest available
        const res = await this.bridge.getMeasure(bridge, moduleId, "sum_energy_elec", "1day");
        // body is Record<timestamp, (number|null)[]> — get the last non-null value
        const timestamps = Object.keys(res.body).sort();
        for (let i = timestamps.length - 1; i >= 0; i--) {
          const values = res.body[timestamps[i]];
          if (values.length > 0 && values[0] !== null) {
            this.deviceManager.updateDeviceData("netatmo_hc", friendlyName, {
              sum_energy_elec: values[0],
            });
            break;
          }
        }
      } catch (err) {
        this.logger.warn({ err, moduleId, friendlyName }, "Failed to fetch energy measure");
      }
    }
  }
}
