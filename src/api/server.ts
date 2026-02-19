import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Logger } from "../core/logger.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { MqttConnector } from "../mqtt/mqtt-connector.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWebSocket } from "./websocket.js";

interface ServerDeps {
  deviceManager: DeviceManager;
  eventBus: EventBus;
  mqttConnector: MqttConnector;
  logger: Logger;
  corsOrigins: string[];
}

export async function createServer(deps: ServerDeps) {
  const { deviceManager, eventBus, mqttConnector, logger, corsOrigins } = deps;

  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  });

  // WebSocket
  await app.register(websocket);

  // Register routes
  registerHealthRoutes(app, { deviceManager, mqttConnector, logger });
  registerDeviceRoutes(app, { deviceManager, logger });
  registerWebSocket(app, { eventBus, logger });

  return app;
}
