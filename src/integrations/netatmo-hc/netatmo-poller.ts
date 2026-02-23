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
import { isSupportedModule, mapModuleToDiscovered, extractStatusPayload } from "./netatmo-types.js";

const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 min
const DEFAULT_ON_DEMAND_DELAY_MS = 10_000; // 10s after order

export class NetatmoPoller {
  private bridge: NetatmoBridge;
  private deviceManager: DeviceManager;
  private logger: Logger;
  private homeId: string;
  private pollIntervalMs: number;
  private onDemandDelayMs: number;

  private interval: ReturnType<typeof setInterval> | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private polling = false;

  /** Map of moduleId → friendlyName, built during discovery. */
  private moduleNames = new Map<string, string>();

  constructor(
    bridge: NetatmoBridge,
    deviceManager: DeviceManager,
    homeId: string,
    logger: Logger,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onDemandDelayMs = DEFAULT_ON_DEMAND_DELAY_MS,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.homeId = homeId;
    this.logger = logger.child({ module: "netatmo-poller" });
    this.pollIntervalMs = pollIntervalMs;
    this.onDemandDelayMs = onDemandDelayMs;
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
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.logger.info("Netatmo poller stopped");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  scheduleOnDemandPoll(delayMs?: number): void {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.poll().catch((err) => this.logger.error({ err }, "Netatmo on-demand poll failed"));
    }, delayMs ?? this.onDemandDelayMs);
    this.pendingTimers.add(timer);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      // 1. Discover modules
      await this.discoverModules();

      // 2. Poll status
      await this.pollStatus();
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

    const activeIds = new Set<string>();

    for (const mod of home.modules) {
      if (!isSupportedModule(mod.type)) {
        this.logger.debug({ type: mod.type, name: mod.name }, "Skipping unsupported module type");
        continue;
      }

      const discovered = mapModuleToDiscovered(mod, this.homeId);
      this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", discovered);

      // Track moduleId → friendlyName for status updates
      const name = mod.name || mod.id;
      this.moduleNames.set(mod.id, name);
      activeIds.add(name); // sourceDeviceId = friendlyName
    }

    // Remove stale devices that no longer exist
    this.deviceManager.removeStaleDevices("netatmo_hc", activeIds);
  }

  private async pollStatus(): Promise<void> {
    const status = await this.bridge.getHomeStatus(this.homeId);
    const modules = status.body.home.modules;

    for (const mod of modules) {
      const friendlyName = this.moduleNames.get(mod.id);
      if (!friendlyName) continue; // Not a supported/discovered module

      const payload = extractStatusPayload(mod);
      if (Object.keys(payload).length === 0) continue;

      this.deviceManager.updateDeviceData("netatmo_hc", friendlyName, payload);
    }
  }
}
