import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createLogger } from "./core/logger.js";
import { LogRingBuffer } from "./core/log-buffer.js";
import { openDatabase, runMigrations } from "./core/database.js";
import { EventBus } from "./core/event-bus.js";
import { DeviceManager } from "./devices/device-manager.js";
import { ZoneManager } from "./zones/zone-manager.js";
import { EquipmentManager } from "./equipments/equipment-manager.js";
import { ZoneAggregator } from "./zones/zone-aggregator.js";
import { SunlightManager } from "./zones/sunlight-manager.js";
import { RecipeManager } from "./recipes/engine/recipe-manager.js";
import { MotionLightRecipe } from "./recipes/motion-light.js";
import { MotionLightDimmableRecipe } from "./recipes/motion-light-dimmable.js";
import { SwitchLightRecipe } from "./recipes/switch-light.js";
import { PresenceThermostatRecipe } from "./recipes/presence-thermostat.js";
import { PresenceHeaterRecipe } from "./recipes/presence-heater.js";
import { StateWatchRecipe } from "./recipes/state-watch.js";
import { UserManager } from "./auth/user-manager.js";
import { AuthService } from "./auth/auth-service.js";
import { SettingsManager } from "./core/settings-manager.js";
import { ModeManager } from "./modes/mode-manager.js";
import { CalendarManager } from "./modes/calendar-manager.js";
import { ButtonActionManager } from "./buttons/button-action-manager.js";
import { IntegrationRegistry } from "./integrations/integration-registry.js";
import { EnergyAggregator } from "./energy/energy-aggregator.js";
import { HistoryWriter } from "./history/history-writer.js";
import { InfluxClient } from "./core/influx-client.js";
import { ChartManager } from "./charts/chart-manager.js";
import { MqttBrokerManager } from "./mqtt-publishers/mqtt-broker-manager.js";
import { MqttPublisherManager } from "./mqtt-publishers/mqtt-publisher-manager.js";
import { MqttPublishService } from "./mqtt-publishers/mqtt-publish-service.js";
import { NotificationPublisherManager } from "./notifications/notification-publisher-manager.js";
import { NotificationPublishService } from "./notifications/notification-publish-service.js";
import { PackageManager } from "./packages/package-manager.js";
import { PluginLoader } from "./plugins/plugin-loader.js";
import { createServer } from "./api/server.js";

/**
 * Ensure only one Sowel instance runs at a time.
 * Writes a PID file; if it already exists with a live process, exits immediately.
 */
function acquirePidLock(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const pidFile = resolve(dataDir, "sowel.pid");

  if (existsSync(pidFile)) {
    const existingPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (!isNaN(existingPid)) {
      try {
        // signal 0 = check if process exists without killing it
        process.kill(existingPid, 0);
        // Process is alive — abort
        console.error(
          `Another Sowel instance is already running (PID ${existingPid}). Remove ${pidFile} if this is stale.`,
        );
        process.exit(1);
      } catch {
        // Process not found — stale PID file, overwrite it
      }
    }
  }

  writeFileSync(pidFile, String(process.pid), { mode: 0o644 });
  return pidFile;
}

async function main() {
  // 0. Ensure single instance via PID lock
  const pidFile = acquirePidLock("./data");
  const cleanupPid = () => {
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore — file may already be gone
    }
  };
  process.on("exit", cleanupPid);
  process.on("SIGINT", () => {
    cleanupPid();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanupPid();
    process.exit(0);
  });

  // 1. Load configuration
  const config = loadConfig();

  // 2. Initialize logger with ring buffer for UI log viewer
  const logBuffer = new LogRingBuffer();
  const logHandle = createLogger(config.log.level, logBuffer);
  const logger = logHandle.logger;
  logger.info("Sowel — Founded by Marc Chachereau — AGPL-3.0");

  // 3. Open SQLite database and run migrations
  const db = openDatabase(config.sqlite.path, logger);
  const migrationsDir = resolve(
    import.meta.dirname ?? new URL(".", import.meta.url).pathname,
    "../migrations",
  );
  runMigrations(db, migrationsDir, logger);

  // 4. Create Settings Manager
  const settingsManager = new SettingsManager(db);

  // 5. Create Event Bus
  const eventBus = new EventBus(logger);

  // 6. Create Device Manager
  const deviceManager = new DeviceManager(db, eventBus, logger);

  // 7. Create Integration Registry and register plugins
  const integrationRegistry = new IntegrationRegistry(logger);

  // 8. Create Zone Manager & ensure root zone exists
  const zoneManager = new ZoneManager(db, eventBus, logger);
  zoneManager.ensureRootZone();

  // 9. Create Equipment Manager (uses IntegrationRegistry for order dispatch)
  const equipmentManager = new EquipmentManager(
    db,
    eventBus,
    integrationRegistry,
    deviceManager,
    logger,
  );

  // 10. Create Zone Aggregator + Sunlight Manager
  const zoneAggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
  const sunlightManager = new SunlightManager(settingsManager, eventBus, logger);
  zoneAggregator.setSunlightManager(sunlightManager);

  // 11. Create InfluxDB client and connect
  const influxClient = new InfluxClient(logger);
  influxClient.connect(config.influx);

  // Setup downsampling buckets and tasks (fire-and-forget)
  Promise.all([
    influxClient.ensureBuckets(),
    influxClient.ensureDownsamplingTasks(),
    influxClient.ensureEnergyBuckets(),
  ]).catch((err) => {
    logger.warn({ err }, "InfluxDB bucket/task setup failed — will retry on next restart");
  });

  // 11a. Create History Writer (passive observer — subscribes to events, writes to InfluxDB)
  const historyWriter = new HistoryWriter(
    db,
    eventBus,
    settingsManager,
    equipmentManager,
    influxClient,
    logger,
  );

  // 11b. Create Chart Manager
  const chartManager = new ChartManager(db, logger);

  // 11c. Create MQTT Broker Manager & Publisher Manager (service created after RecipeManager)
  const mqttBrokerManager = new MqttBrokerManager(db, eventBus, logger);
  const mqttPublisherManager = new MqttPublisherManager(db, eventBus, logger);

  // 12. Create Recipe Manager
  const recipeManager = new RecipeManager(
    db,
    eventBus,
    equipmentManager,
    zoneManager,
    zoneAggregator,
    logger,
  );
  recipeManager.register(MotionLightRecipe);
  recipeManager.register(MotionLightDimmableRecipe);
  recipeManager.register(SwitchLightRecipe);
  recipeManager.register(PresenceThermostatRecipe);
  recipeManager.register(PresenceHeaterRecipe);
  recipeManager.register(StateWatchRecipe);

  // 12b. Create Notification Publisher Manager & Service
  const notificationPublisherManager = new NotificationPublisherManager(db, eventBus, logger);
  const notificationPublishService = new NotificationPublishService(
    eventBus,
    notificationPublisherManager,
    equipmentManager,
    zoneAggregator,
    recipeManager,
    logger,
  );

  // 12c. Create MQTT Publish Service (needs RecipeManager)
  const mqttPublishService = new MqttPublishService(
    eventBus,
    mqttBrokerManager,
    mqttPublisherManager,
    equipmentManager,
    zoneAggregator,
    recipeManager,
    logger,
  );

  // 13. Create Mode Manager + Calendar Manager
  const modeManager = new ModeManager(db, eventBus, equipmentManager, recipeManager, logger);
  const calendarManager = new CalendarManager(db, eventBus, settingsManager, modeManager, logger);

  // 12b. Create Button Action Manager
  const buttonActionManager = new ButtonActionManager(
    db,
    eventBus,
    equipmentManager,
    modeManager,
    recipeManager,
    logger,
  );

  // 13. Create Auth modules
  const userManager = new UserManager(db, logger);
  const authService = new AuthService(db, userManager, config.jwt, logger);

  // 14. Create Package Manager + Plugin Loader and load plugins
  const packageManager = new PackageManager(db, logger);
  const pluginLoader = new PluginLoader(
    packageManager,
    integrationRegistry,
    { logger, eventBus, settingsManager, deviceManager },
    logger,
  );
  await pluginLoader.loadAll();

  // 15. Start Fastify server BEFORE integrations (UI available immediately)
  // Integrations start in background with staggered polling
  const server = await createServer({
    db,
    deviceManager,
    zoneManager,
    zoneAggregator,
    equipmentManager,
    recipeManager,
    modeManager,
    calendarManager,
    userManager,
    authService,
    settingsManager,
    buttonActionManager,
    historyWriter,
    influxClient,
    chartManager,
    mqttBrokerManager,
    mqttPublisherManager,
    mqttPublishService,
    notificationPublisherManager,
    notificationPublishService,
    packageManager,
    pluginLoader,
    eventBus,
    integrationRegistry,
    logBuffer,
    logger,
    corsOrigins: config.cors.origins,
    dataDir: dirname(resolve(config.sqlite.path)),
  });

  await server.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, host: config.api.host },
    `Sowel API listening on http://${config.api.host}:${config.api.port}`,
  );

  // 16. Start Sunlight Manager (before system.started so aggregation has sunlight data)
  sunlightManager.start();

  // 17. Emit system started event (triggers zone aggregation compute)
  eventBus.emit({ type: "system.started" });

  // 17. Initialize recipe manager (restore persisted instances — after aggregation is ready)
  recipeManager.init();

  // 18. Initialize history writer (connects to InfluxDB if configured, subscribes to events)
  historyWriter.init();

  // 18a. Start Energy Aggregator
  const energyAggregator = new EnergyAggregator(equipmentManager, influxClient, eventBus, logger);
  await energyAggregator
    .start()
    .catch((err) => logger.warn({ err }, "Energy aggregator start failed"));

  // 18b. Initialize MQTT publish service (connects to MQTT broker, subscribes to events)
  mqttPublishService.init();

  // 18c. Initialize notification publish service (subscribes to events)
  notificationPublishService.init();

  // 19. Initialize mode manager, calendar, and button actions
  modeManager.init();
  calendarManager.init();
  buttonActionManager.init();

  if (!userManager.hasUsers()) {
    logger.info("No users found — setup required. Navigate to the UI to create the first admin.");
  }

  logger.info("Sowel engine started successfully");

  // 20. Start all integrations in background with staggered polling
  // This runs after the server is listening — UI is already accessible
  integrationRegistry.startAll().catch((err) => {
    logger.error({ err }, "Failed to start integrations");
  });

  // Graceful shutdown — each step is isolated so one failure doesn't block the rest
  const shutdown = async () => {
    logger.info("Shutting down...");
    try {
      sunlightManager.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping sunlight manager");
    }
    try {
      calendarManager.stopAll();
    } catch (err) {
      logger.error({ err }, "Error stopping calendar manager");
    }
    try {
      recipeManager.stopAll();
    } catch (err) {
      logger.error({ err }, "Error stopping recipe manager");
    }
    try {
      notificationPublishService.destroy();
    } catch (err) {
      logger.error({ err }, "Error stopping notification publish service");
    }
    try {
      await mqttPublishService.destroy();
    } catch (err) {
      logger.error({ err }, "Error stopping MQTT publish service");
    }
    try {
      historyWriter.destroy();
    } catch (err) {
      logger.error({ err }, "Error stopping history writer");
    }
    try {
      await influxClient.disconnect();
    } catch (err) {
      logger.error({ err }, "Error disconnecting InfluxDB");
    }
    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, "Error closing HTTP server");
    }
    try {
      await integrationRegistry.stopAll();
    } catch (err) {
      logger.error({ err }, "Error stopping integrations");
    }
    try {
      db.close();
    } catch (err) {
      logger.error({ err }, "Error closing database");
    }
    logger.info("Shutdown complete");
    await logHandle.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // Use stderr JSON as last resort — logger may not be initialized yet
  const entry = {
    level: "fatal",
    time: new Date().toISOString(),
    msg: "Fatal error",
    err: String(err),
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
  process.exit(1);
});
