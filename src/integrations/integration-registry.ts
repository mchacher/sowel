import type { Logger } from "../core/logger.js";
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
  start(): Promise<void>;

  /** Stop the integration gracefully */
  stop(): Promise<void>;

  /**
   * Execute an order on a device managed by this integration.
   * @param device The target device
   * @param dispatchConfig Integration-specific order config
   * @param value The value to set
   */
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;

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
}

// ============================================================
// IntegrationRegistry
// ============================================================

export class IntegrationRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "integration-registry" });
  }

  register(plugin: IntegrationPlugin): void {
    if (this.plugins.has(plugin.id)) {
      this.logger.warn({ integrationId: plugin.id }, "Integration already registered, replacing");
    }
    this.plugins.set(plugin.id, plugin);
    this.logger.info({ integrationId: plugin.id, name: plugin.name }, "Integration registered");
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
      };
    });
  }

  async startAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.isConfigured()) {
        try {
          await plugin.start();
          this.logger.info({ integrationId: plugin.id }, "Integration started");
        } catch (err) {
          this.logger.error({ err, integrationId: plugin.id }, "Failed to start integration");
        }
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
