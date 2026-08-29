import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type {
  IntegrationInfo,
  IntegrationStatus,
  IntegrationSettingDef,
  Device,
} from "../shared/types.js";

// ============================================================
// IntegrationPlugin interface
// ============================================================

export interface IntegrationPlugin {
  /** Unique integration type ID (e.g. "zigbee2mqtt", "panasonic-cc") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description for UI */
  readonly description: string;
  /** Lucide icon name */
  readonly icon: string;
  /** Current connection/health status */
  getStatus(): IntegrationStatus;

  /** Check if required settings are configured */
  isConfigured(): boolean;

  /** Settings schema for the UI config form */
  getSettingsSchema(): IntegrationSettingDef[];

  /** Start the integration (connect, subscribe, start polling, etc.) */
  start(options?: { pollOffset?: number }): Promise<void>;

  /** Stop the integration gracefully */
  stop(): Promise<void>;

  /**
   * Execute an order on a device managed by this integration.
   */
  executeOrder(device: Device, orderKey: string, value: unknown): Promise<void>;

  /**
   * Force a data refresh (e.g. re-poll cloud API).
   * Optional — integrations that don't support it should return immediately.
   */
  refresh?(): Promise<void>;

  /**
   * Return polling timing info (last poll timestamp + interval).
   * Optional — only for polling-based integrations.
   */
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;

  /**
   * Return the OAuth 2.0 authorization URL to redirect the user to.
   * Optional — only for OAuth-based integrations.
   * Returns null if OAuth is not applicable or not yet configured.
   */
  getOAuthUrl?(): string | null;

  /**
   * Handle the OAuth 2.0 authorization code callback.
   * Exchange the code for access_token + refresh_token and store them.
   * Optional — only for OAuth-based integrations.
   */
  handleOAuthCallback?(code: string): Promise<void>;
}

// ============================================================
// IntegrationRegistry
// ============================================================

/**
 * Interval at which every plugin's connection status is sampled to derive
 * `system.integration.{connected,disconnected}`. `getStatus()` is an in-memory
 * read on every plugin, so sampling is cheap.
 */
const STATUS_POLL_MS = 2_000;

/** Interval at which `waitForConnections` re-checks the configured plugins. */
const READINESS_POLL_MS = 250;

export class IntegrationRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();
  private logger: Logger;
  /** Last sampled status per plugin id — the baseline for transition detection. */
  private lastStatus: Map<string, IntegrationStatus> = new Map();
  private statusTimer: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "integration-registry" });
  }

  /**
   * Read a plugin's status without letting a throwing plugin break the sweep.
   * `wrapPluginMethods` (spec 111) already degrades `getStatus` for loaded
   * plugins; this covers everything else that reaches the registry.
   */
  private safeStatus(plugin: IntegrationPlugin): IntegrationStatus {
    try {
      return plugin.getStatus();
    } catch {
      // Deliberately silent: this runs on every sweep, and `wrapPluginMethods`
      // (spec 111) already logs the throw once with the plugin's context. The
      // transition to "error" is what gets reported, not each failed read.
      return "error";
    }
  }

  /**
   * Issue #702 — derive connection transitions from the plugins themselves.
   *
   * `system.integration.connected` exists in the event union and plugins are
   * allowed to emit it, but nothing in core ever did, so no consumer could rely
   * on it. Sampling `getStatus()` here makes the signal dependable regardless
   * of what a given plugin chooses to emit, which is what lets the order
   * confirmation tracker replay an order that could not be dispatched.
   *
   * The first sweep only seeds the baseline: a status observed at boot is not a
   * transition.
   */
  startStatusWatch(eventBus: EventBus): void {
    if (this.statusTimer) return;
    for (const plugin of this.plugins.values()) {
      this.lastStatus.set(plugin.id, this.safeStatus(plugin));
    }
    this.statusTimer = setInterval(() => {
      try {
        this.sampleStatus(eventBus);
      } catch (err) {
        this.logger.error({ err }, "Integration status sweep failed");
      }
    }, STATUS_POLL_MS);
    this.statusTimer.unref?.();
  }

  /**
   * Record that an integration was found unreachable outside the sampling
   * loop, so the next sweep reports its recovery as a transition.
   *
   * A plugin that drops and recovers between two samples looks unchanged to
   * `sampleStatus`, and no `system.integration.connected` is emitted. That is
   * invisible to most consumers but not to the order confirmation tracker: an
   * order held during such a flap would never be released (issue #702).
   */
  noteUnreachable(integrationId: string): void {
    if (!this.plugins.has(integrationId)) return;
    if (this.lastStatus.get(integrationId) === "connected") {
      this.lastStatus.set(integrationId, "disconnected");
    }
  }

  stopStatusWatch(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.lastStatus.clear();
  }

  private sampleStatus(eventBus: EventBus): void {
    for (const plugin of this.plugins.values()) {
      const current = this.safeStatus(plugin);
      const previous = this.lastStatus.get(plugin.id);
      this.lastStatus.set(plugin.id, current);
      // A plugin registered since the last sweep (runtime install) is seeded,
      // not reported: we never saw what it transitioned from.
      if (previous === undefined || previous === current) continue;
      if (current === "connected") {
        this.logger.info({ integrationId: plugin.id }, "Integration connected");
        eventBus.emit({ type: "system.integration.connected", integrationId: plugin.id });
      } else if (previous === "connected") {
        this.logger.warn({ integrationId: plugin.id, status: current }, "Integration disconnected");
        eventBus.emit({ type: "system.integration.disconnected", integrationId: plugin.id });
      }
    }
    for (const id of [...this.lastStatus.keys()]) {
      if (!this.plugins.has(id)) this.lastStatus.delete(id);
    }
  }

  /**
   * Issue #702 — resolve once every configured plugin reports "connected", or
   * when `timeoutMs` elapses, whichever comes first. Returns the ids still not
   * connected so the caller can say so.
   *
   * `start()` resolving does not mean a plugin is reachable: MQTT connects and
   * cloud logins complete asynchronously afterwards. Polling the status the
   * plugins actually report is the only honest readiness signal, and the
   * timeout keeps one unreachable cloud integration from holding the engine.
   */
  async waitForConnections(timeoutMs: number): Promise<{ pending: string[] }> {
    const deadline = Date.now() + timeoutMs;
    // Snapshot once: isConfigured() reads settings, and re-reading them on
    // every 250 ms iteration is thousands of prepared statements over the wait.
    const watched = this.getAll().filter((p) => p.isConfigured());
    for (;;) {
      const pending = watched
        .filter((p) => {
          const status = this.safeStatus(p);
          // "not_configured" from a plugin that claims to be configured means
          // it is waiting on the user (an OAuth flow it cannot complete on its
          // own). Waiting the full timeout on it would delay every boot.
          return status !== "connected" && status !== "not_configured";
        })
        .map((p) => p.id);
      if (pending.length === 0) return { pending };
      if (Date.now() >= deadline) return { pending };
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, READINESS_POLL_MS);
        t.unref?.();
      });
    }
  }

  register(plugin: IntegrationPlugin): void {
    if (this.plugins.has(plugin.id)) {
      this.logger.warn({ integrationId: plugin.id }, "Integration already registered, replacing");
    }
    this.plugins.set(plugin.id, plugin);
    this.logger.info({ integrationId: plugin.id, name: plugin.name }, "Integration registered");
  }

  unregister(id: string): void {
    this.plugins.delete(id);
    this.logger.info({ integrationId: id }, "Integration unregistered");
  }

  getById(id: string): IntegrationPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): IntegrationPlugin[] {
    return Array.from(this.plugins.values());
  }

  getAllInfo(): IntegrationInfo[] {
    return this.getAll().map((plugin) => {
      const polling = plugin.getPollingInfo?.() ?? undefined;
      return {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        status: plugin.getStatus(),
        settings: plugin.getSettingsSchema(),
        configured: plugin.isConfigured(),
        polling,
        deviceCount: 0,
        offlineDeviceCount: 0,
        supportsOAuth: typeof plugin.getOAuthUrl === "function",
      };
    });
  }

  /**
   * Dispatch an order to a plugin.
   */
  async dispatchOrder(
    integrationId: string,
    device: Device,
    orderKey: string,
    value: unknown,
  ): Promise<void> {
    const plugin = this.plugins.get(integrationId);
    if (!plugin) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    await plugin.executeOrder(device, orderKey, value);
  }

  async startAll(): Promise<void> {
    const STAGGER_MS = 10_000;
    let pollerIndex = 0;

    for (const plugin of this.plugins.values()) {
      if (plugin.isConfigured()) {
        const isPolling = typeof plugin.getPollingInfo === "function";
        const pollOffset = isPolling ? pollerIndex * STAGGER_MS : undefined;
        try {
          await plugin.start({ pollOffset });
          this.logger.info({ integrationId: plugin.id }, "Integration started");
        } catch (err) {
          this.logger.error({ err, integrationId: plugin.id }, "Failed to start integration");
        }
        if (isPolling) pollerIndex++;
      } else {
        this.logger.info(
          { integrationId: plugin.id },
          "Integration not configured — skipping start",
        );
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.stop();
        this.logger.info({ integrationId: plugin.id }, "Integration stopped");
      } catch (err) {
        this.logger.error({ err, integrationId: plugin.id }, "Failed to stop integration");
      }
    }
  }
}
