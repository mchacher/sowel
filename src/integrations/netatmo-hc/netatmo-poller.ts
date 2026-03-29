/**
 * NetatmoPoller — Periodic polling of Netatmo Home+Control API.
 *
 * On each poll:
 * 1. GET /api/homesdata → discover modules → upsertFromDiscovery
 * 2. GET /api/homestatus → read live values → updateDeviceData
 */

import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
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

/** Sliding window: query last 6h of energy data on each poll cycle. */
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
  private rapidInterval: ReturnType<typeof setInterval> | null = null;
  private rapidTimeout: ReturnType<typeof setTimeout> | null = null;
  private rapidStopTimeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private pollFailed = false;
  private rapidPolling = false;
  private lastPollAt: string | null = null;
  private staggerTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Map of moduleId → friendlyName, built during discovery. */
  private moduleNames = new Map<string, string>();
  /** Enable Home+Control device polling (homesdata / homestatus). */
  private enableHomeControl: boolean;
  /** Enable energy monitoring (bridge-level 5min polling). */
  private enableEnergy: boolean;
  /** Bridge ID discovered from energy meters — used for bridge-level queries. */
  private bridgeId: string | null = null;
  /** Friendly name of the NLPC module that receives bridge-level energy data. */
  private mainMeterName: string | null = null;
  /** High-water mark: highest window timestamp emitted to EnergyAggregator this session. */
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
    enableHomeControl = true,
    enableEnergy = false,
  ) {
    this.bridge = bridge;
    this.deviceManager = deviceManager;
    this.equipmentManager = equipmentManager;
    this.eventBus = eventBus;
    this.homeId = homeId;
    this.logger = logger.child({ module: "legrand-hc-poller" });
    this.pollIntervalMs = pollIntervalMs;
    this.enableHomeControl = enableHomeControl;
    this.enableEnergy = enableEnergy;
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

  isPollHealthy(): boolean {
    return !this.pollFailed;
  }

  getBridgeId(): string | null {
    return this.bridgeId;
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

      // Phase 1: discovery
      let hcActiveIds: Set<string> = new Set();
      let hcDiscoveryOk = !this.enableHomeControl;
      if (this.enableHomeControl) {
        try {
          hcActiveIds = await this.discoverModules();
          hcDiscoveryOk = true;
        } catch (err) {
          this.logger.error({ err }, "Home+Control discovery failed");
        }
      }

      // Stale device cleanup AFTER discovery is complete
      if (hcDiscoveryOk) {
        this.deviceManager.removeStaleDevices("netatmo_hc", hcActiveIds);
      } else {
        this.logger.warn("Skipping stale device cleanup — discovery incomplete");
      }

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

      if (this.pollFailed) {
        this.pollFailed = false;
        this.eventBus.emit({
          type: "system.alarm.resolved",
          alarmId: "poll-fail:netatmo_hc",
          source: "Legrand Home+Control",
          message: "Communication rétablie",
        });
      }
    } catch (err) {
      this.logger.error({ err }, "Legrand H+C poll cycle failed");
      if (!this.pollFailed) {
        this.pollFailed = true;
        this.eventBus.emit({
          type: "system.alarm.raised",
          alarmId: "poll-fail:netatmo_hc",
          level: "error",
          source: "Legrand Home+Control",
          message: `Poll en échec : ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      this.polling = false;
    }
  }

  /** Returns the set of active HC module friendly names discovered. */
  private async discoverModules(): Promise<Set<string>> {
    const homesData = await this.bridge.getHomesData();
    const home = homesData.body.homes.find((h) => h.id === this.homeId);
    if (!home) {
      throw new Error(`Home ${this.homeId} not found in homesdata response`);
    }

    const modules = home.modules ?? [];
    this.logger.info(
      { homeId: this.homeId, homeName: home.name, moduleCount: modules.length },
      "Legrand H+C discovery: scanning home",
    );

    if (modules.length === 0) {
      throw new Error("Legrand H+C discovery returned 0 modules — API response may be incomplete");
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

      // Energy meters: capture bridgeId + identify main meter for bridge-level energy injection
      if (METER_TYPES.has(mod.type)) {
        if (mod.bridge && !this.bridgeId) {
          this.bridgeId = mod.bridge;
          this.logger.info(
            { moduleId: mod.id, bridge: mod.bridge, type: mod.type },
            "Energy meter detected — bridge ID captured",
          );
        }
        // First NLPC with a bridge becomes the main meter (receives bridge-level energy)
        if (this.enableEnergy && !this.mainMeterName && mod.bridge) {
          this.mainMeterName = mod.name || mod.id;
          this.logger.info(
            { moduleId: mod.id, name: this.mainMeterName },
            "Main energy meter identified for bridge-level data",
          );
        }
      }

      const discovered = mapModuleToDiscovered(mod, this.homeId);
      this.deviceManager.upsertFromDiscovery("netatmo_hc", "netatmo_hc", discovered);

      supported++;

      // Track moduleId → friendlyName for status updates
      const name = mod.name || mod.id;
      this.moduleNames.set(mod.id, name);
      activeIds.add(name); // sourceDeviceId = friendlyName
    }

    this.logger.info(
      { total: modules.length, supported, skipped: modules.length - supported },
      "Legrand H+C discovery complete",
    );

    // Weather names are merged and stale cleanup is done in poll()
    // after all Phase 1 discovery is complete (avoids race condition).
    return activeIds;
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

  /**
   * Poll bridge-level energy data (30-min granularity).
   * Queries aligned 30-min windows after lastEnergyTimestamp.
   * Writes raw energy (Wh) and demand_30min (W) to device data.
   * Cumuls (day/hour/month/year) are handled by EnergyAggregator at equipment level.
   */
  /**
   * Query a 30-min energy window and return consumption + production Wh.
   * consumption = buy_from_grid$1 + buy_from_grid$2 + self_consumption (total house)
   * production  = self_consumption + resell_to_grid (total solar)
   */
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
    const production = autoconso + injection;
    return { consumption, production, autoconso, injection };
  }

  /**
   * Resolve the Device friendlyName bound to the energy_production_meter Equipment.
   * Returns null if no production Equipment exists or has no energy binding.
   */
  private resolveProductionDeviceName(): string | null {
    const eq = this.equipmentManager.getAll().find((e) => e.type === "energy_production_meter");
    if (!eq) return null;
    const binding = this.equipmentManager
      .getDataBindingsWithValues(eq.id)
      .find((b) => b.alias === "energy");
    if (!binding) return null;
    return binding.deviceName ?? null;
  }

  private async pollEnergyMeters(): Promise<void> {
    if (!this.enableEnergy || !this.bridgeId || !this.mainMeterName) return;

    try {
      const nowTs = Math.floor(Date.now() / 1000);
      const HALF_HOUR = 1800;

      // Sliding window: always query last 6h of aligned 30-min windows.
      // InfluxDB overwrites existing points (same tags + timestamp = idempotent).
      // No data lag guard needed: if Netatmo returns partial data for the latest
      // window, the next poll cycle will overwrite it with the final value.
      const lookbackStart = Math.floor((nowTs - ENERGY_LOOKBACK_S) / HALF_HOUR) * HALF_HOUR;

      let newBuckets = 0;
      let lastBucketEnergy = 0;
      let lastBucketProduction = 0;

      for (let windowStart = lookbackStart; windowStart < nowTs; windowStart += HALF_HOUR) {
        const windowEnd = windowStart + HALF_HOUR;
        // Only process windows that have ended
        if (windowEnd > nowTs) break;

        const { consumption, production, autoconso, injection } = await this.queryEnergyWindow(
          windowStart,
          windowEnd,
        );
        if (consumption <= 0 && production <= 0) continue;

        // Pass sourceTimestamp = windowStart so HistoryWriter writes at the
        // aligned 30-min boundary, not at "now".
        // InfluxDB overwrites if the point already exists (idempotent).
        if (consumption > 0) {
          this.deviceManager.updateDeviceData(
            "netatmo_hc",
            this.mainMeterName!,
            { energy: consumption },
            windowStart,
          );
        }

        // Write production, autoconso, injection on the production Device
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

      // Write demand_30min (instantaneous power from last bucket)
      if (lastBucketEnergy > 0) {
        this.deviceManager.updateDeviceData("netatmo_hc", this.mainMeterName!, {
          demand_30min: Math.round(lastBucketEnergy * 2), // Wh/30min → W
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
}
