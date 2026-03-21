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
}

export type PluginFactory = (deps: PluginDeps) => IntegrationPlugin;
