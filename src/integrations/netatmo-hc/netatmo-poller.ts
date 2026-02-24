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
  mapWeatherStationToDiscovered,
  mapWeatherModuleToDiscovered,
  extractWeatherPayload,
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
  private lastPollAt: string | null = null;
  private staggerTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Map of moduleId → friendlyName, built during discovery. */
  private moduleNames = new Map<string, string>();
  /** Energy meters: moduleId → { bridge, friendlyName } */
  private energyMeters = new Map<string, { bridge: string; friendlyName: string }>();
  /** Weather station friendly names tracked for stale device removal. */
  private weatherNames = new Set<string>();
  /** Enable Home+Control device polling (homesdata / homestatus). */
  private enableHomeControl: boolean;
  /** Enable weather station polling (read_station scope). */
  private enableWeather: boolean;

  constructor(
    bridge: NetatmoBridge,
    deviceManager: DeviceManager,
    homeId: string,
    logger: Logger,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    enableHomeControl = true,
    enableWeather = false,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.homeId = homeId;
    this.logger = logger.child({ module: "legrand-hc-poller" });
    this.pollIntervalMs = pollIntervalMs;
    this.enableHomeControl = enableHomeControl;
    this.enableWeather = enableWeather;
  }

  async start(pollOffset = 0): Promise<void> {
    this.logger.info(
      { homeId: this.homeId, intervalMs: this.pollIntervalMs, pollOffset },
      "Starting Legrand H+C poller",
    );
    // Immediate first poll (awaited — data available at startup)
    await this.poll();
    // Stagger recurring polls by pollOffset so integrations don't all fire at once
    const startInterval = () => {
      this.interval = setInterval(() => {
        this.poll().catch((err) => this.logger.error({ err }, "Legrand H+C poll failed"));
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
    this.stopRapidPoll();
    this.logger.info("Legrand H+C poller stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    if (!this.lastPollAt) return null;
    return { lastPollAt: this.lastPollAt, intervalMs: this.pollIntervalMs };
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
            this.logger.debug("Legrand H+C rapid poll skipped (rate-limited)");
          } else {
            this.logger.error({ err }, "Legrand H+C rapid poll failed");
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
      this.lastPollAt = new Date().toISOString();
      const t0 = Date.now();

      // Phase 1: independent discovery calls in parallel
      const phase1: Promise<void>[] = [];
      if (this.enableHomeControl) {
        phase1.push(
          this.discoverModules().catch((err) =>
            this.logger.error({ err }, "Home+Control discovery failed"),
          ),
        );
      }
      if (this.enableWeather) {
        phase1.push(
          this.pollWeatherStation().catch((err) =>
            this.logger.warn({ err }, "Weather station poll failed (phase 1)"),
          ),
        );
      }
      await Promise.all(phase1);
      const t1 = Date.now();

      // Phase 2: status + energy (depend on discovery results)
      if (this.enableHomeControl) {
        const phase2: Promise<unknown>[] = [
          this.pollStatus().catch((err) =>
            this.logger.error({ err }, "Home+Control status poll failed"),
          ),
          this.pollEnergyMeters().catch((err) =>
            this.logger.warn({ err }, "Energy meters poll failed"),
          ),
        ];
        await Promise.all(phase2);
      }
      const t2 = Date.now();

      this.logger.debug(
        { phase1Ms: t1 - t0, phase2Ms: t2 - t1, totalMs: t2 - t0 },
        "Legrand H+C poll timing",
      );
    } catch (err) {
      this.logger.error({ err }, "Legrand H+C poll cycle failed");
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
      "Legrand H+C discovery: scanning home",
    );

    if (modules.length === 0) {
      this.logger.warn("Legrand H+C discovery: no modules found — check API response");
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
      "Legrand H+C discovery complete",
    );

    // Add weather names to active set so they don't get removed
    for (const name of this.weatherNames) {
      activeIds.add(name);
    }

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
      // Always call to refresh lastSeen even if payload is empty
      this.deviceManager.updateDeviceData("netatmo_hc", friendlyName, payload);
      updated++;

      if (expected && mod.id === expected.moduleId && payload[expected.param] === expected.value) {
        confirmed = true;
      }
    }

    this.logger.info({ updated, total: modules.length }, "Legrand H+C status poll complete");
    return confirmed;
  }

  /** Discover and poll weather station data via getstationsdata. */
  private async pollWeatherStation(): Promise<void> {
    try {
      const stationsData = await this.bridge.getStationsData();
      const devices = stationsData.body.devices;

      if (devices.length === 0) {
        this.logger.debug("No weather stations found");
        return;
      }

      this.weatherNames.clear();

      for (const station of devices) {
        // Discover + update base station (NAMain)
        const baseName = station.module_name || station.station_name;
        const baseDiscovered = mapWeatherStationToDiscovered(station);
        this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", baseDiscovered);
        this.weatherNames.add(baseName);

        // Update base station data (always call to refresh lastSeen)
        const basePayload = extractWeatherPayload(station.dashboard_data, station.type);
        this.deviceManager.updateDeviceData("netatmo_hc", baseName, basePayload);

        // Discover + update each sub-module
        for (const mod of station.modules ?? []) {
          const modName = mod.module_name || mod._id;
          const modDiscovered = mapWeatherModuleToDiscovered(mod);
          this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", modDiscovered);
          this.weatherNames.add(modName);

          // Build combined payload: sensor data + battery
          const modPayload: Record<string, unknown> = mod.dashboard_data
            ? extractWeatherPayload(mod.dashboard_data, mod.type)
            : {};
          if (mod.battery_percent !== undefined) {
            modPayload.battery = mod.battery_percent;
          }
          // Always call to refresh lastSeen even if payload is empty
          this.deviceManager.updateDeviceData("netatmo_hc", modName, modPayload);
        }
      }

      this.logger.info(
        { stationCount: devices.length, weatherDevices: this.weatherNames.size },
        "Weather station poll complete",
      );
    } catch (err) {
      this.logger.warn({ err }, "Weather station poll failed");
    }
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
