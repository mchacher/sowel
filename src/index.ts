import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { loadConfig } from "./config.js";
import { createLogger, purgeLegacyLogFiles } from "./core/logger.js";
import { LogRingBuffer } from "./core/log-buffer.js";
import { installProcessCrashHandlers } from "./core/process-crash-handlers.js";
import { AuditLogger } from "./core/audit-logger.js";
import { openDatabase, runMigrations } from "./core/database.js";
import { detectTimezone, probeTimezone, readHomeCoordinatesRaw } from "./core/timezone.js";
import { EventBus } from "./core/event-bus.js";
import { DeviceManager } from "./devices/device-manager.js";
import { ZoneManager } from "./zones/zone-manager.js";
import { EquipmentManager } from "./equipments/equipment-manager.js";
import { EquipmentStatusTracker } from "./equipments/equipment-status-tracker.js";
import { OrderConfirmationTracker } from "./equipments/order-confirmation-tracker.js";
import { PoolRuntimeTracker } from "./equipments/pool-runtime-tracker.js";
import { PoolWaterTempTracker } from "./equipments/pool-water-temp-tracker.js";
import { WeatherTempExtremesTracker } from "./equipments/weather-temp-extremes-tracker.js";
import { ZoneAggregator } from "./zones/zone-aggregator.js";
import { SunlightManager } from "./zones/sunlight-manager.js";
import { RecipeManager } from "./recipes/engine/recipe-manager.js";
import { CapacityArbiter } from "./energy/capacity-arbiter.js";
import { ActivityBuffer } from "./activity/activity-buffer.js";
import { RecipeLoader } from "./recipes/recipe-loader.js";
import { VersionChecker } from "./core/version-checker.js";
import { UpdateManager } from "./core/update-manager.js";
import { BackupManager } from "./backup/backup-manager.js";
import { UserManager } from "./auth/user-manager.js";
import { AuthService } from "./auth/auth-service.js";
import { SettingsManager } from "./core/settings-manager.js";
import { resolveInstanceIdentity, confirmTakeover } from "./core/instance-identity.js";
import { ModeManager } from "./modes/mode-manager.js";
import { CalendarManager } from "./modes/calendar-manager.js";
import { ButtonActionManager } from "./buttons/button-action-manager.js";
import { IntegrationRegistry } from "./integrations/integration-registry.js";
import { EnergyAggregator } from "./energy/energy-aggregator.js";
import { SelfConsumptionWriter } from "./energy/self-consumption-writer.js";
import { HistoryWriter } from "./history/history-writer.js";
import { PowerSubmeterIntegrator } from "./energy/power-submeter-integrator.js";
import { InfluxClient } from "./core/influx-client.js";
import { ChartManager } from "./charts/chart-manager.js";
import { MqttBrokerManager } from "./mqtt-publishers/mqtt-broker-manager.js";
import { MqttPublisherManager } from "./mqtt-publishers/mqtt-publisher-manager.js";
import { MqttPublishService } from "./mqtt-publishers/mqtt-publish-service.js";
import { NotificationPublisherManager } from "./notifications/notification-publisher-manager.js";
import { PushSubscriptionManager } from "./notifications/push-subscription-manager.js";
import { ensureVapidKeys } from "./notifications/vapid.js";
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

  // Spec 124 — run a boot step only outside shadow mode; in shadow mode emit a
  // single consistent "Skipping <label>" line. `config.shadowMode` is read live
  // so a takeover flip (below) is honoured. Supports sync and async steps.
  const runUnlessShadow = async (label: string, fn: () => void | Promise<void>): Promise<void> => {
    if (config.shadowMode) {
      logger.warn({ module: "shadow-mode" }, `Skipping ${label}`);
      return;
    }
    await fn();
  };

  // Spec 112: install crash handlers as soon as the logger is ready.
  // Throws before this point are caught by the `main().catch()` block
  // at the bottom of this file (stderr JSON fallback).
  installProcessCrashHandlers(logger);

  // #400 follow-up — pre-date-format log files are invisible to pino-roll's
  // retention; drop the ones past the normal 14-day window.
  purgeLegacyLogFiles(logger);

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

  // Spec 124 — Shadow mode banner. Emit BEFORE any subsystem boots so
  // the warning is the first non-tz line in the log. The hostname is
  // included so the operator can verify they did not flip the env var
  // on production by mistake (`os.hostname()` returns the container's
  // hostname under Docker, but for shadow runs that is meaningful
  // enough).
  if (config.shadowMode) {
    logger.warn(
      {
        module: "shadow-mode",
        hostname: hostname(),
      },
      "SHADOW MODE ACTIVE — outbound integrations, recipes, publishers, and version checks are disabled. This instance is safe to run against a copy of production data.",
    );
  }

  // WAN exposure warnings (spec 105)
  const corsRaw = process.env["CORS_ORIGINS"];
  if (corsRaw === "*") {
    logger.warn(
      "CORS is set to wildcard '*'. This is dangerous if Sowel is exposed to the Internet. Restrict CORS_ORIGINS to known origins.",
    );
    const apiHost = process.env["API_HOST"];
    if (apiHost !== "127.0.0.1" && apiHost !== "localhost") {
      logger.warn(
        { apiHost: apiHost ?? "0.0.0.0" },
        "CORS=* combined with a non-loopback API_HOST is the highest-risk configuration. Restrict at least one before exposing this instance to the public Internet.",
      );
    }
  }

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

  // 4b. Issue #401 — restored-data guardrail. A database restored from
  // another deployment (prod backup on a dev machine, hardware migration)
  // must not dial out with the origin's brokers and OAuth grants. When the
  // stored instance id disagrees with the local marker, force the spec 124
  // shadow gates for this boot; the admin confirms the takeover in the UI
  // (or via SOWEL_TAKEOVER=1) and restarts to arm the instance.
  const identity = resolveInstanceIdentity({
    settingsManager,
    dataDir: config.dataDir,
    takeoverConfirmed: config.takeoverConfirmed,
    logger,
  });
  if (identity.takeoverPending && !config.shadowMode) {
    config.shadowMode = true;
    logger.warn(
      { module: "instance-identity", hostname: hostname() },
      "TAKEOVER PENDING — starting with shadow gates active: outbound integrations, recipes, publishers, notifications, and version checks are disabled until the takeover is confirmed.",
    );
  }

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

  // 9c. Create Pool Water Temp Tracker (gates water temp by filtration/mode for pool_heat_pump)
  const poolWaterTempTracker = new PoolWaterTempTracker(db, eventBus, equipmentManager, logger);
  equipmentManager.registerComputedDataProvider((eqId) =>
    poolWaterTempTracker.getComputedDataForEquipment(eqId),
  );

  // 9d. Weather temp extremes tracker (spec 134) — daily min/max per temperature
  // binding on weather equipments, exposed as computed data.
  const weatherTempExtremesTracker = new WeatherTempExtremesTracker(
    db,
    eventBus,
    equipmentManager,
    logger,
  );
  equipmentManager.registerComputedDataProvider((eqId) =>
    weatherTempExtremesTracker.getComputedDataForEquipment(eqId),
  );

  // 10. Create Zone Aggregator + Sunlight Manager
  const zoneAggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
  const sunlightManager = new SunlightManager(settingsManager, eventBus, logger);
  zoneAggregator.setSunlightManager(sunlightManager);

  // 10b. Equipment availability tracker (spec 116) — emits equipment.status.changed
  // on transitions between online/degraded/offline so the WebSocket layer can push
  // the new state to UI clients without polling.
  const equipmentStatusTracker = new EquipmentStatusTracker(equipmentManager, eventBus, logger);
  equipmentStatusTracker.start();

  // 10c. Order delivery confirmation (spec 141) — watches dispatched orders,
  // raises an alarm when the mirror binding never reports the ordered value,
  // and re-dispatches once when the target device comes back online. Inert in
  // shadow mode along with everything else that dispatches orders.
  const orderConfirmationTracker = new OrderConfirmationTracker(
    eventBus,
    equipmentManager,
    deviceManager,
    integrationRegistry,
    logger,
  );
  await runUnlessShadow("orderConfirmationTracker.init()", () => orderConfirmationTracker.init());

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

  // 11d. Create Capacity Arbiter (spec 140) — single meter reader arbitrating
  // solar surplus between declared flexible loads. Default off; zero behavior
  // until `energy.arbiter.enabled` is set.
  const capacityArbiter = new CapacityArbiter(
    eventBus,
    settingsManager,
    equipmentManager,
    logger,
    config.shadowMode, // spec 124 — a shadow instance never arbitrates
  );
  capacityArbiter.start();

  // 12. Create Recipe Manager
  const recipeManager = new RecipeManager(
    db,
    eventBus,
    equipmentManager,
    zoneManager,
    zoneAggregator,
    sunlightManager, // spec 126 — exposes ctx.helpers.getSunlight() to recipes
    historyWriter.getTariffClassifier(), // spec 138 — read-only ctx.helpers.getTariff()
    logger,
    config.shadowMode, // spec 124 — runtime gate on startInstance
    capacityArbiter, // spec 140 — ctx.helpers.energy claims
  );
  // All recipes are now external packages loaded by RecipeLoader

  // 12b. Create Notification Publisher Manager & Service
  const notificationPublisherManager = new NotificationPublisherManager(db, eventBus, logger);
  // Spec 127 — Web Push: per-user subscriptions + server-global VAPID keys.
  const pushSubscriptionManager = new PushSubscriptionManager(db, logger);
  const vapidKeys = ensureVapidKeys(settingsManager, logger);
  const notificationPublishService = new NotificationPublishService(
    eventBus,
    notificationPublisherManager,
    equipmentManager,
    zoneAggregator,
    recipeManager,
    pushSubscriptionManager,
    vapidKeys,
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

  // 13b. Create Activity Buffer (spec 101) — depends on equipment / recipe / zone / sunlight managers
  const activityBuffer = new ActivityBuffer(
    eventBus,
    equipmentManager,
    recipeManager,
    zoneManager,
    sunlightManager,
    logger,
  );

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

  // 13b. Audit logger (spec 113) — instantiate and purge entries > 365 days
  const auditLogger = new AuditLogger(db, logger);
  const purgedAuditRows = auditLogger.purgeOlderThan();
  if (purgedAuditRows > 0) {
    logger.info({ purged: purgedAuditRows }, "Audit log retention purge complete");
  }

  // 14. Create Package Manager + warm registry cache (await remote fetch before loading plugins)
  const packageManager = new PackageManager(db, logger);
  await packageManager.warmRegistryCache();

  const pluginLoader = new PluginLoader(
    packageManager,
    integrationRegistry,
    { logger, eventBus, settingsManager, deviceManager },
    logger,
    config.shadowMode, // spec 124 — runtime gate on loadPlugin
  );
  // Spec 124 — loadAll iterates installed packages and calls
  // loadPlugin per id; the runtime gate would no-op every one of
  // them. Skip the whole pass to keep the boot log clean.
  await runUnlessShadow("pluginLoader.loadAll()", () => pluginLoader.loadAll());

  // 14b. Load external recipe packages (must be before recipeManager.init)
  const recipeLoader = new RecipeLoader(packageManager, recipeManager, logger);
  await runUnlessShadow("recipeLoader.loadAll()", () => recipeLoader.loadAll());

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
    pushSubscriptionManager,
    vapidKeys,
    packageManager,
    pluginLoader,
    recipeLoader,
    capacityArbiter,
    backupManager,
    versionChecker,
    updateManager,
    tzInfo,
    sunlightManager,
    eventBus,
    integrationRegistry,
    logBuffer,
    activityBuffer,
    auditLogger,
    logger,
    corsOrigins: config.cors.origins,
    shadowMode: config.shadowMode,
    takeoverPending: identity.takeoverPending,
    confirmTakeover: () => {
      confirmTakeover({ settingsManager, dataDir: config.dataDir, logger });
    },
    requestRestart: () => {
      logger.warn(
        { module: "instance-identity" },
        "Restarting to complete the takeover (docker restart policy will bring the engine back armed)",
      );
      setTimeout(() => process.exit(0), 500);
    },
  });

  await server.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, host: config.api.host },
    `Sowel API listening on http://${config.api.host}:${config.api.port}`,
  );

  // 16. Start Sunlight Manager (before system.started so aggregation has sunlight data)
  sunlightManager.start();

  // 16a. Start Activity Buffer (after sunlightManager so it can read initial isDaylight)
  activityBuffer.start();

  // 16b. Start version checker (polls GitHub releases for updates)
  // Spec 124 — skip in shadow mode (no outbound, including GitHub).
  await runUnlessShadow("versionChecker.start()", () => versionChecker.start());

  // 17. Emit system started event (triggers zone aggregation compute)
  eventBus.emit({ type: "system.started" });

  // 17. Initialize recipe manager (restore persisted instances — after aggregation is ready)
  // Spec 124 — skip in shadow mode (no recipe should re-arm on a
  // shadow). The runtime gate on startInstance is the second line
  // of defence for runtime UI actions.
  await runUnlessShadow("recipeManager.init()", () => recipeManager.init());

  // 17b. Start pool runtime tracker (subscribes to equipment.data.changed)
  poolRuntimeTracker.start();

  // 17c. Start pool water temp tracker (gates water temp by filtration/mode)
  poolWaterTempTracker.start();

  // 17d. Start weather temp extremes tracker (spec 134)
  weatherTempExtremesTracker.start();

  // 18. Initialize history writer (connects to InfluxDB if configured, subscribes to events)
  historyWriter.init();

  // 18-bis. Self-consumption writer: derives autoconso/injection from
  // Grid + Solar energy ticks AND owns the grid-side energy/hp/hc series,
  // writing the household-level equivalent so the consumption chart matches
  // the legacy Netatmo semantic (spec 086 step F). The HistoryWriter skips
  // those three aliases on the main_energy_meter whenever a production meter
  // is configured — one writer per series, no upsert race.
  const selfConsumptionWriter = new SelfConsumptionWriter(
    eventBus,
    equipmentManager,
    influxClient,
    historyWriter.getTariffClassifier(),
    logger,
  );
  selfConsumptionWriter.init();

  // 18a. Start Energy Aggregator
  const energyAggregator = new EnergyAggregator(equipmentManager, influxClient, eventBus, logger);
  await energyAggregator
    .start()
    .catch((err) => logger.warn({ err }, "Energy aggregator start failed"));

  // 18b. Power-only submeter integrator (Legrand GEM-style clamps that
  // expose `power` but not cumulative `energy`). Integrates W → Wh and
  // writes per-minute deltas attributed to the submeter equipment.
  const powerSubmeterIntegrator = new PowerSubmeterIntegrator(
    db,
    eventBus,
    equipmentManager,
    influxClient,
    logger,
  );
  powerSubmeterIntegrator.init();
  powerSubmeterIntegrator.start();
  equipmentManager.registerComputedDataProvider((eqId) =>
    powerSubmeterIntegrator.getComputedDataForEquipment(eqId),
  );

  // 18a-bis. Start Weather Aggregator (rain cumuls)
  const { WeatherAggregator } = await import("./weather/weather-aggregator.js");
  const weatherAggregator = new WeatherAggregator(equipmentManager, influxClient, eventBus, logger);
  await weatherAggregator
    .start()
    .catch((err) => logger.warn({ err }, "Weather aggregator start failed"));

  // 18b. Initialize MQTT publish service (connects to MQTT broker, subscribes to events)
  // Spec 124 — skip in shadow mode; the service is monolithic and has
  // no runtime entry point, so the boot gate alone keeps it inert.
  await runUnlessShadow("mqttPublishService.init()", () => mqttPublishService.init());

  // 18c. Initialize notification publish service (subscribes to events)
  await runUnlessShadow("notificationPublishService.init()", () =>
    notificationPublishService.init(),
  );

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
      capacityArbiter.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping capacity arbiter");
    }
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
      orderConfirmationTracker.destroy();
    } catch (err) {
      logger.error({ err }, "Error stopping order confirmation tracker");
    }
    try {
      poolWaterTempTracker.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping pool water temp tracker");
    }
    try {
      weatherTempExtremesTracker.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping weather temp extremes tracker");
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
      selfConsumptionWriter.destroy();
    } catch (err) {
      logger.error({ err }, "Error stopping self-consumption writer");
    }
    try {
      powerSubmeterIntegrator.flushAll();
      powerSubmeterIntegrator.stop();
    } catch (err) {
      logger.error({ err }, "Error stopping power submeter integrator");
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
