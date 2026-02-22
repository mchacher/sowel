import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./core/logger.js";
import { openDatabase, runMigrations } from "./core/database.js";
import { EventBus } from "./core/event-bus.js";
import { DeviceManager } from "./devices/device-manager.js";
import { ZoneManager } from "./zones/zone-manager.js";
import { EquipmentManager } from "./equipments/equipment-manager.js";
import { ZoneAggregator } from "./zones/zone-aggregator.js";
import { RecipeManager } from "./recipes/engine/recipe-manager.js";
import { MotionLightRecipe } from "./recipes/motion-light.js";
import { UserManager } from "./auth/user-manager.js";
import { AuthService } from "./auth/auth-service.js";
import { SettingsManager } from "./core/settings-manager.js";
import { ModeManager } from "./modes/mode-manager.js";
import { CalendarManager } from "./modes/calendar-manager.js";
import { IntegrationRegistry } from "./integrations/integration-registry.js";
import { Zigbee2MqttIntegration } from "./integrations/zigbee2mqtt/index.js";
import { PanasonicCCIntegration } from "./integrations/panasonic-cc/index.js";
import { createServer } from "./api/server.js";

async function main() {
  // 1. Load configuration
  const config = loadConfig();

  // 2. Initialize logger
  const logger = createLogger(config.log.level);
  logger.info("Corbel engine starting...");

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

  const zigbee2mqttIntegration = new Zigbee2MqttIntegration(
    settingsManager,
    deviceManager,
    eventBus,
    logger,
  );
  integrationRegistry.register(zigbee2mqttIntegration);

  const panasonicCCIntegration = new PanasonicCCIntegration(
    settingsManager,
    deviceManager,
    eventBus,
    logger,
  );
  integrationRegistry.register(panasonicCCIntegration);

  // 8. Create Zone Manager
  const zoneManager = new ZoneManager(db, eventBus, logger);

  // 9. Create Equipment Manager (uses IntegrationRegistry for order dispatch)
  const equipmentManager = new EquipmentManager(
    db,
    eventBus,
    integrationRegistry,
    deviceManager,
    logger,
  );

  // 10. Create Zone Aggregator
  const zoneAggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);

  // 11. Create Recipe Manager
  const recipeManager = new RecipeManager(
    db,
    eventBus,
    equipmentManager,
    zoneManager,
    zoneAggregator,
    logger,
  );
  recipeManager.register(MotionLightRecipe);

  // 12. Create Mode Manager + Calendar Manager
  const modeManager = new ModeManager(db, eventBus, equipmentManager, recipeManager, logger);
  const calendarManager = new CalendarManager(db, eventBus, settingsManager, modeManager, logger);

  // 13. Create Auth modules
  const userManager = new UserManager(db, logger);
  const authService = new AuthService(db, userManager, config.jwt, logger);

  // 14. Start all configured integrations
  await integrationRegistry.startAll();

  // 15. Start Fastify server
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
    eventBus,
    integrationRegistry,
    logger,
    corsOrigins: config.cors.origins,
  });

  await server.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, host: config.api.host },
    `Corbel API listening on http://${config.api.host}:${config.api.port}`,
  );

  // 16. Emit system started event (triggers zone aggregation compute)
  eventBus.emit({ type: "system.started" });

  // 17. Initialize recipe manager (restore persisted instances — after aggregation is ready)
  recipeManager.init();

  // 18. Initialize mode manager and calendar (event triggers + cron scheduling)
  modeManager.init();
  calendarManager.init();

  if (!userManager.hasUsers()) {
    logger.info("No users found — setup required. Navigate to the UI to create the first admin.");
  }

  logger.info("Corbel engine started successfully");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    recipeManager.stopAll();
    await server.close();
    await integrationRegistry.stopAll();
    db.close();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
