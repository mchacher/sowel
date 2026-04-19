import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createLogger } from "./core/logger.js";
import { LogRingBuffer } from "./core/log-buffer.js";
import { openDatabase, runMigrations } from "./core/database.js";
import { detectTimezone, probeTimezone, readHomeCoordinatesRaw } from "./core/timezone.js";
import { EventBus } from "./core/event-bus.js";
import { DeviceManager } from "./devices/device-manager.js";
import { ZoneManager } from "./zones/zone-manager.js";
import { EquipmentManager } from "./equipments/equipment-manager.js";
import { PoolRuntimeTracker } from "./equipments/pool-runtime-tracker.js";
import { ZoneAggregator } from "./zones/zone-aggregator.js";
import { SunlightManager } from "./zones/sunlight-manager.js";
import { RecipeManager } from "./recipes/engine/recipe-manager.js";
import { RecipeLoader } from "./recipes/recipe-loader.js";
import { VersionChecker } from "./core/version-checker.js";
import { UpdateManager } from "./core/update-manager.js";
import { BackupManager } from "./backup/backup-manager.js";
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
 * Clean up any stale PID file from a previous run.
 * In Docker, PID is always 1 so the old lock check was unreliable
 * (it detected itself as "another instance"). Docker's container_name
 * already ensures single-instance; we just clean up the file.
 */
function cleanStalePidFile(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const pidFile = resolve(dataDir, "sowel.pid");
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore — file may not exist
    }
  }
}

async function main() {
  // 0. Clean up any stale PID file from a previous run
  cleanStalePidFile("./data");

  process.on("SIGINT", () => {
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    process.exit(0);
  });

  // 1. Load configuration
  const config = loadConfig();

  // 2. Open SQLite database (BEFORE logger — needed for timezone detection)
  //    The database opens without a logger at this stage; log messages about
  //    db creation will be emitted later once the logger is ready.
  const db = openDatabase(config.sqlite.path);

  // 3. Detect timezone from home settings BEFORE creating the logger.
  //    ⚠️ CRITICAL: pino uses `new Date()` on first log, which caches the TZ
  //    in V8. We must set `process.env.TZ` before that first Date call.
  const { latitude, longitude } = readHomeCoordinatesRaw(db);
  const tzResult = detectTimezone({
    latitude,
    longitude,
    tzEnv: process.env["TZ"],
  });
  process.env["TZ"] = tzResult.tz;
  const tzProbe = probeTimezone();

  // 4. Initialize logger with ring buffer for UI log viewer
  //    (Date is now using the correct TZ.)
  const logBuffer = new LogRingBuffer();
  const logHandle = createLogger(config.log.level, logBuffer);
  const logger = logHandle.logger;

  // Flush deferred timezone diagnostics
  const tzLogger = logger.child({ module: "timezone" });
  for (const msg of tzResult.diag) {
    tzLogger.info(msg);
  }
  tzLogger.info(
    {
      tz: tzResult.tz,
      source: tzResult.source,
      probe: tzProbe.probe,
      offsetHours: tzProbe.offsetHours,
    },
    "Timezone applied",
  );

  logger.info("Sowel — Founded by Marc Chachereau — AGPL-3.0");

  // Snapshot for /api/v1/system/timezone endpoint
  const tzInfo = {
    tz: tzResult.tz,
    source: tzResult.source,
    offsetHours: tzProbe.offsetHours,
  };

  // 5. Run migrations
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

  // 9b. Create Pool Runtime Tracker (accumulates daily ON-time per pool_pump)
  const poolRuntimeTracker = new PoolRuntimeTracker(db, eventBus, equipmentManager, logger);
  equipmentManager.registerComputedDataProvider((eqId) =>
    poolRuntimeTracker.getComputedDataForEquipment(eqId),
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
  // All recipes are now external packages loaded by RecipeLoader

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
    zoneManager,
    logger,
  );

  // 13. Create Auth modules
  const userManager = new UserManager(db, logger);
  const authService = new AuthService(db, userManager, config.jwt, logger);

  // 14. Create Package Manager + warm registry cache (await remote fetch before loading plugins)
  const packageManager = new PackageManager(db, logger);
  await packageManager.warmRegistryCache();

  const pluginLoader = new PluginLoader(
    packageManager,
    integrationRegistry,
    { logger, eventBus, settingsManager, deviceManager },
    logger,
  );
  await pluginLoader.loadAll();

  // 14b. Load external recipe packages (must be before recipeManager.init)
  const recipeLoader = new RecipeLoader(packageManager, recipeManager, logger);
  await recipeLoader.loadAll();

  // 14c. Create backup manager (used by routes and update manager)
  const backupManager = new BackupManager({
    db,
    influxClient,
    logger,
    dataDir: dirname(resolve(config.sqlite.path)),
  });

  // 14d. Create version checker + update manager
  const updateManager = new UpdateManager(eventBus, backupManager, logger);
  // Refresh compose context once on startup so getComposeContext() is sync afterwards
  await updateManager.refreshComposeContext();
  const versionChecker = new VersionChecker(eventBus, updateManager, logger);

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
    recipeLoader,
    backupManager,
    versionChecker,
    updateManager,
    tzInfo,
    eventBus,
    integrationRegistry,
    logBuffer,
    logger,
    corsOrigins: config.cors.origins,
  });

  await server.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, host: config.api.host },
    `Sowel API listening on http://${config.api.host}:${config.api.port}`,
  );

  // 16. Start Sunlight Manager (before system.started so aggregation has sunlight data)
  sunlightManager.start();

  // 16b. Start version checker (polls GitHub releases for updates)
  versionChecker.start();

  // 17. Emit system started event (triggers zone aggregation compute)
  eventBus.emit({ type: "system.started" });

  // 17. Initialize recipe manager (restore persisted instances — after aggregation is ready)
  recipeManager.init();

  // 17b. Start pool runtime tracker (subscribes to equipment.data.changed)
  poolRuntimeTracker.start();

  // 18. Initialize history writer (connects to InfluxDB if configured, subscribes to events)
  historyWriter.init();

  // 18a. Start Energy Aggregator
  const energyAggregator = new EnergyAggregator(equipmentManager, influxClient, eventBus, logger);
  await energyAggregator
    .start()
    .catch((err) => logger.warn({ err }, "Energy aggregator start failed"));

  // 18a-bis. Start Weather Aggregator (rain cumuls)
  const { WeatherAggregator } = await import("./weather/weather-aggregator.js");
  const weatherAggregator = new WeatherAggregator(equipmentManager, influxClient, eventBus, logger);
  await weatherAggregator
    .start()
    .catch((err) => logger.warn({ err }, "Weather aggregator start failed"));

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
      versionChecker.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping version checker");
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
      poolRuntimeTracker.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping pool runtime tracker");
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
