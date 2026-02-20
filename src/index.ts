import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./core/logger.js";
import { openDatabase, runMigrations } from "./core/database.js";
import { EventBus } from "./core/event-bus.js";
import { MqttConnector } from "./mqtt/mqtt-connector.js";
import { DeviceManager } from "./devices/device-manager.js";
import { ZoneManager } from "./zones/zone-manager.js";
import { EquipmentManager } from "./equipments/equipment-manager.js";
import { Zigbee2MqttParser } from "./mqtt/parsers/zigbee2mqtt.js";
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

  // 4. Create Event Bus
  const eventBus = new EventBus(logger);

  // 5. Create MQTT Connector
  const mqttConnector = new MqttConnector(
    config.mqtt.url,
    {
      username: config.mqtt.username,
      password: config.mqtt.password,
      clientId: config.mqtt.clientId,
    },
    eventBus,
    logger,
  );

  // 6. Create Device Manager
  const deviceManager = new DeviceManager(db, eventBus, logger);

  // 6b. Create Zone Manager
  const zoneManager = new ZoneManager(db, eventBus, logger);

  // 6c. Create Equipment Manager
  const equipmentManager = new EquipmentManager(db, eventBus, mqttConnector, logger);

  // 7. Create zigbee2mqtt parser
  const z2mParser = new Zigbee2MqttParser(
    config.z2m.baseTopic,
    mqttConnector,
    deviceManager,
    logger,
  );

  // 8. Connect to MQTT and start parser
  await mqttConnector.connect();
  z2mParser.start();

  // 9. Start Fastify server
  const server = await createServer({
    deviceManager,
    zoneManager,
    equipmentManager,
    eventBus,
    mqttConnector,
    logger,
    corsOrigins: config.cors.origins,
  });

  await server.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, host: config.api.host },
    `Corbel API listening on http://${config.api.host}:${config.api.port}`,
  );

  // 10. Emit system started event
  eventBus.emit({ type: "system.started" });
  logger.info("Corbel engine started successfully");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await server.close();
    await mqttConnector.disconnect();
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
