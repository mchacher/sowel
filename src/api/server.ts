import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { Logger } from "../core/logger.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { ZoneManager } from "../zones/zone-manager.js";
import type { ZoneAggregator } from "../zones/zone-aggregator.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { MqttConnector } from "../mqtt/mqtt-connector.js";
import type Database from "better-sqlite3";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { ModeManager } from "../modes/mode-manager.js";
import type { CalendarManager } from "../modes/calendar-manager.js";
import type { UserManager } from "../auth/user-manager.js";
import type { AuthService } from "../auth/auth-service.js";
import type { SettingsManager } from "../core/settings-manager.js";
import { registerAuthMiddleware } from "../auth/auth-middleware.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerZoneRoutes } from "./routes/zones.js";
import { registerEquipmentRoutes } from "./routes/equipments.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerBackupRoutes } from "./routes/backup.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerModeRoutes } from "./routes/modes.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerWebSocket } from "./websocket.js";

interface ServerDeps {
  db: Database.Database;
  deviceManager: DeviceManager;
  zoneManager: ZoneManager;
  zoneAggregator: ZoneAggregator;
  equipmentManager: EquipmentManager;
  recipeManager: RecipeManager;
  modeManager: ModeManager;
  calendarManager: CalendarManager;
  userManager: UserManager;
  authService: AuthService;
  settingsManager: SettingsManager;
  eventBus: EventBus;
  mqttConnector: MqttConnector;
  logger: Logger;
  corsOrigins: string[];
}

export async function createServer(deps: ServerDeps) {
  const {
    db, deviceManager, zoneManager, zoneAggregator, equipmentManager, recipeManager,
    modeManager, calendarManager,
    userManager, authService, settingsManager, eventBus, mqttConnector, logger, corsOrigins,
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
  registerModeRoutes(app, { modeManager, logger });
  registerCalendarRoutes(app, { calendarManager, logger });
  registerBackupRoutes(app, { db, logger });
  registerSettingsRoutes(app, { settingsManager, mqttConnector, logger });
  registerWebSocket(app, { eventBus, authService, logger });

  // Serve UI static files (production: ui/dist is copied alongside dist/)
  const uiDir = resolve(import.meta.dirname ?? ".", "../ui-dist");
  if (existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html");
    });

    logger.info(`Serving UI from ${uiDir}`);
  }

  return app;
}
