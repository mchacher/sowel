import type { EventBus } from "../core/event-bus.js";
import type { Logger } from "../core/logger.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { IntegrationPlugin } from "../integrations/integration-registry.js";
import type { EngineEvent } from "../shared/types.js";

// Spec 111 — Plugin soft isolation via scoped Proxy.
//
// Wraps the three mutable PluginDeps (settings, event bus, device manager)
// so a plugin can only read/write its own scope, and confines errors so
// a misbehaving plugin cannot tear down the core.

/**
 * Settings keys readable by every plugin regardless of ownership.
 * Used for cross-cutting concerns (home location, timezone) that are
 * not secrets and have no per-integration owner.
 */
export const GLOBAL_READABLE_KEYS: ReadonlySet<string> = new Set([
  "home.latitude",
  "home.longitude",
  "home.timezone",
]);

/**
 * Event types a plugin is allowed to emit. Derived from a code audit
 * of all 13 official plugins; the four below cover every observed
 * legitimate use case. Extending this set is a code change reviewed
 * at PR time.
 */
export const ALLOWED_EMIT_TYPES: ReadonlySet<EngineEvent["type"]> = new Set<EngineEvent["type"]>([
  "system.integration.connected",
  "system.integration.disconnected",
  "system.alarm.raised",
  "system.alarm.resolved",
]);

/**
 * Methods on IntegrationPlugin whose errors must propagate back to the
 * caller. Other async methods (refresh, getStatus, etc.) are swallowed
 * to avoid a buggy plugin tearing down the core.
 */
const RETHROW_METHODS = new Set(["start", "stop", "executeOrder", "handleOAuthCallback"]);

/** Default slow-call threshold for the wrapper warning. */
const SLOW_CALL_MS = 1000;

export function makeSettingsManagerProxy(
  pluginId: string,
  inner: SettingsManager,
  logger: Logger,
): SettingsManager {
  const ownPrefix = `integration.${pluginId}.`;
  const isOwn = (k: string): boolean => k.startsWith(ownPrefix);
  const isGlobalReadable = (k: string): boolean => GLOBAL_READABLE_KEYS.has(k);

  return new Proxy(inner, {
    get(target, prop, receiver) {
      switch (prop) {
        case "get":
          return (key: string): string | undefined => {
            if (isOwn(key) || isGlobalReadable(key)) return target.get(key);
            logger.warn({ pluginId, key }, "Plugin denied read on foreign setting");
            return undefined;
          };
        case "set":
          return (key: string, value: string): void => {
            if (isOwn(key)) {
              target.set(key, value);
              return;
            }
            logger.warn({ pluginId, key }, "Plugin denied write on foreign setting");
            throw new Error(`Plugin "${pluginId}" cannot write key "${key}"`);
          };
        case "setMany":
          return (entries: Record<string, string>): void => {
            const violations = Object.keys(entries).filter((k) => !isOwn(k));
            if (violations.length > 0) {
              logger.warn(
                { pluginId, keys: violations },
                "Plugin denied bulk write on foreign keys",
              );
              throw new Error(`Plugin "${pluginId}" attempted foreign setMany`);
            }
            target.setMany(entries);
          };
        case "getAll":
          return (): Record<string, string> => {
            logger.warn({ pluginId }, "Plugin denied getAll");
            return {};
          };
        case "getByPrefix":
          return (prefix: string): Record<string, string> => {
            if (prefix.startsWith(ownPrefix)) return target.getByPrefix(prefix);
            logger.warn({ pluginId, prefix }, "Plugin denied getByPrefix on foreign prefix");
            return {};
          };
        case "getMqttConfig":
          return () => {
            if (pluginId !== "zigbee2mqtt") {
              logger.warn({ pluginId }, "Plugin denied getMqttConfig (restricted to zigbee2mqtt)");
              throw new Error("getMqttConfig is restricted to zigbee2mqtt");
            }
            return target.getMqttConfig();
          };
        case "getZ2mConfig":
          return () => {
            if (pluginId !== "zigbee2mqtt") {
              throw new Error("getZ2mConfig is restricted to zigbee2mqtt");
            }
            return target.getZ2mConfig();
          };
        default: {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}

export function makeEventBusProxy(pluginId: string, inner: EventBus, logger: Logger): EventBus {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      switch (prop) {
        case "emit":
          return (event: EngineEvent): void => {
            if (!ALLOWED_EMIT_TYPES.has(event.type)) {
              logger.warn(
                { pluginId, eventType: event.type },
                "Plugin denied emit (type not in allowlist)",
              );
              return;
            }
            if (
              "integrationId" in event &&
              (event as { integrationId: string }).integrationId !== pluginId
            ) {
              logger.warn(
                {
                  pluginId,
                  claimed: (event as { integrationId: string }).integrationId,
                  eventType: event.type,
                },
                "Plugin denied emit (integrationId impersonation)",
              );
              return;
            }
            target.emit(event);
          };
        default: {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}

export function makeDeviceManagerProxy(
  pluginId: string,
  inner: DeviceManager,
  logger: Logger,
): DeviceManager {
  const denyForeign = (integrationId: string, op: string): void => {
    if (integrationId !== pluginId) {
      logger.warn(
        { pluginId, integrationId, op },
        "Plugin denied DeviceManager call on foreign integration",
      );
      throw new Error(
        `Plugin "${pluginId}" cannot call DeviceManager.${op} on integration "${integrationId}"`,
      );
    }
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      switch (prop) {
        case "upsertFromDiscovery":
          return (
            integrationId: Parameters<DeviceManager["upsertFromDiscovery"]>[0],
            source: Parameters<DeviceManager["upsertFromDiscovery"]>[1],
            discovered: Parameters<DeviceManager["upsertFromDiscovery"]>[2],
          ): void => {
            denyForeign(integrationId, "upsertFromDiscovery");
            target.upsertFromDiscovery(integrationId, source, discovered);
          };
        case "updateDeviceData":
          return (
            integrationId: string,
            sourceDeviceId: string,
            payload: Record<string, unknown>,
            sourceTimestamp?: number,
          ): void => {
            denyForeign(integrationId, "updateDeviceData");
            target.updateDeviceData(integrationId, sourceDeviceId, payload, sourceTimestamp);
          };
        case "updateDeviceStatus":
          return (
            integrationId: string,
            sourceDeviceId: string,
            status: "online" | "offline",
          ): void => {
            denyForeign(integrationId, "updateDeviceStatus");
            target.updateDeviceStatus(integrationId, sourceDeviceId, status);
          };
        case "markRemoved":
          return (integrationId: string, sourceDeviceId: string): void => {
            denyForeign(integrationId, "markRemoved");
            target.markRemoved(integrationId, sourceDeviceId);
          };
        case "removeStaleDevices":
          return (integrationId: string, activeDeviceIds: Set<string>): void => {
            denyForeign(integrationId, "removeStaleDevices");
            target.removeStaleDevices(integrationId, activeDeviceIds);
          };
        case "migrateIntegrationId":
          return (
            oldIntegrationId: string,
            newIntegrationId: string,
            models?: string[],
          ): number => {
            if (newIntegrationId !== pluginId) {
              logger.warn(
                { pluginId, newIntegrationId },
                "Plugin denied migrateIntegrationId on foreign target",
              );
              throw new Error(
                `Plugin "${pluginId}" can only migrate to own id (got "${newIntegrationId}")`,
              );
            }
            return target.migrateIntegrationId(oldIntegrationId, newIntegrationId, models);
          };
        case "update":
          return () => {
            logger.warn({ pluginId }, "Plugin denied DeviceManager.update (admin-only)");
            throw new Error(`Plugin "${pluginId}" cannot call DeviceManager.update`);
          };
        case "delete":
          return () => {
            logger.warn({ pluginId }, "Plugin denied DeviceManager.delete (admin-only)");
            throw new Error(`Plugin "${pluginId}" cannot call DeviceManager.delete`);
          };
        default: {
          // Read methods (getAll, getById, getDeviceData, getDeviceDataValue,
          // logSummary, getRawExpose, etc.) pass through to the real
          // DeviceManager. They are read-only and a plugin reading data
          // from another integration is rare but legitimate (e.g. a pool
          // recipe reading a weather equipment).
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}

/**
 * Wrap the plugin's lifecycle methods so a throw is logged with
 * pluginId context and either rethrown (start, stop, executeOrder,
 * handleOAuthCallback — callers need the error) or swallowed (refresh,
 * getStatus, etc. — degraded view, no crash).
 *
 * Also records per-call duration and emits a `warn` line above the
 * slow-call threshold so a runaway plugin is visible in logs.
 */
export function wrapPluginMethods(
  plugin: IntegrationPlugin,
  pluginId: string,
  logger: Logger,
): IntegrationPlugin {
  function wrapAsync<Args extends unknown[], R>(
    name: string,
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R | undefined> {
    return async (...args: Args): Promise<R | undefined> => {
      const start = performance.now();
      try {
        return await fn(...args);
      } catch (err) {
        logger.error({ err, pluginId, method: name }, "Plugin async method threw");
        if (RETHROW_METHODS.has(name)) throw err;
        return undefined;
      } finally {
        const ms = performance.now() - start;
        if (ms > SLOW_CALL_MS) {
          logger.warn({ pluginId, method: name, ms }, "Slow plugin call");
        }
      }
    };
  }

  function wrapSync<R>(name: string, fn: () => R, fallback: R): () => R {
    return (): R => {
      try {
        return fn();
      } catch (err) {
        logger.error({ err, pluginId, method: name }, "Plugin sync method threw");
        return fallback;
      }
    };
  }

  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    icon: plugin.icon,
    getStatus: wrapSync("getStatus", plugin.getStatus.bind(plugin), "error"),
    isConfigured: wrapSync("isConfigured", plugin.isConfigured.bind(plugin), false),
    getSettingsSchema: wrapSync("getSettingsSchema", plugin.getSettingsSchema.bind(plugin), []),
    start: wrapAsync("start", plugin.start.bind(plugin)) as IntegrationPlugin["start"],
    stop: wrapAsync("stop", plugin.stop.bind(plugin)) as IntegrationPlugin["stop"],
    executeOrder: wrapAsync(
      "executeOrder",
      plugin.executeOrder.bind(plugin),
    ) as IntegrationPlugin["executeOrder"],
    refresh: plugin.refresh
      ? (wrapAsync("refresh", plugin.refresh.bind(plugin)) as IntegrationPlugin["refresh"])
      : undefined,
    getPollingInfo: plugin.getPollingInfo
      ? wrapSync("getPollingInfo", plugin.getPollingInfo.bind(plugin), null)
      : undefined,
    getOAuthUrl: plugin.getOAuthUrl
      ? wrapSync("getOAuthUrl", plugin.getOAuthUrl.bind(plugin), null)
      : undefined,
    handleOAuthCallback: plugin.handleOAuthCallback
      ? (wrapAsync(
          "handleOAuthCallback",
          plugin.handleOAuthCallback.bind(plugin),
        ) as IntegrationPlugin["handleOAuthCallback"])
      : undefined,
  };
}
