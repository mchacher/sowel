import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Logger } from "../core/logger.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { ZoneManager } from "../zones/zone-manager.js";
import type { ZoneAggregator } from "../zones/zone-aggregator.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { MqttConnector } from "../mqtt/mqtt-connector.js";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { UserManager } from "../auth/user-manager.js";
import type { AuthService } from "../auth/auth-service.js";
import { registerAuthMiddleware } from "../auth/auth-middleware.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerZoneRoutes } from "./routes/zones.js";
import { registerEquipmentRoutes } from "./routes/equipments.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerWebSocket } from "./websocket.js";

interface ServerDeps {
  deviceManager: DeviceManager;
  zoneManager: ZoneManager;
  zoneAggregator: ZoneAggregator;
  equipmentManager: EquipmentManager;
  recipeManager: RecipeManager;
  userManager: UserManager;
  authService: AuthService;
  eventBus: EventBus;
  mqttConnector: MqttConnector;
  logger: Logger;
  corsOrigins: string[];
}

export async function createServer(deps: ServerDeps) {
  const {
    deviceManager, zoneManager, zoneAggregator, equipmentManager, recipeManager,
    userManager, authService, eventBus, mqttConnector, logger, corsOrigins,
  } = deps;

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

  // Auth middleware (must be registered before routes)
  registerAuthMiddleware(app, { authService, userManager, logger });

  // Register routes
  registerHealthRoutes(app, { deviceManager, mqttConnector, logger });
  registerAuthRoutes(app, { authService, userManager, logger });
  registerMeRoutes(app, { authService, userManager, logger });
  registerUserRoutes(app, { userManager, logger });
  registerDeviceRoutes(app, { deviceManager, logger });
  registerZoneRoutes(app, { zoneManager, zoneAggregator, logger });
  registerEquipmentRoutes(app, { equipmentManager, logger });
  registerRecipeRoutes(app, { recipeManager, logger });
  registerWebSocket(app, { eventBus, authService, logger });

  return app;
}
