import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationPlugin } from "../integrations/integration-registry.js";

export interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string; // absolute path to this plugin's directory
  /**
   * Spec 180 — absolute path to `data/plugins/<id>/`, created before the
   * factory runs.
   *
   * It exists because `pluginDir` is not a place to keep anything: an update
   * removes that directory wholesale (`PackageManager.updateFiles`) and writes
   * the new release in its place. A plugin that stored its state next to its
   * code lost it at the next version, silently. This directory is never touched
   * by install, update or uninstall, and it is inside the backup.
   */
  dataDir: string;
}

export type PluginFactory = (deps: PluginDeps) => IntegrationPlugin;
