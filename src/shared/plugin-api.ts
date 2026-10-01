import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationPlugin } from "../integrations/integration-registry.js";
import type { SharedAccessApi } from "./types.js";

export interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string; // absolute path to this plugin's directory
  /** Spec 181 R9 — shared accesses, scoped to this plugin. Absent on an engine
   *  without spec 181, so a plugin tests for it before use. */
  sharedAccess?: SharedAccessApi;
}

export type PluginFactory = (deps: PluginDeps) => IntegrationPlugin;
