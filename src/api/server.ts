import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { Logger } from "../core/logger.js";
import type { LogRingBuffer } from "../core/log-buffer.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { ZoneManager } from "../zones/zone-manager.js";
import type { ZoneAggregator } from "../zones/zone-aggregator.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { IntegrationRegistry } from "../integrations/integration-registry.js";
import type Database from "better-sqlite3";
import type { RecipeManager } from "../recipes/engine/recipe-manager.js";
import type { ModeManager } from "../modes/mode-manager.js";
import type { CalendarManager } from "../modes/calendar-manager.js";
import type { UserManager } from "../auth/user-manager.js";
import type { AuthService } from "../auth/auth-service.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { ButtonActionManager } from "../buttons/button-action-manager.js";
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
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerButtonActionRoutes } from "./routes/button-actions.js";
import { registerLogRoutes } from "./routes/logs.js";
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
  buttonActionManager: ButtonActionManager;
  eventBus: EventBus;
  integrationRegistry: IntegrationRegistry;
  logBuffer: LogRingBuffer;
  logger: Logger;
  corsOrigins: string[];
}

export async function createServer(deps: ServerDeps) {
  const {
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
    eventBus,
    integrationRegistry,
    logBuffer,
    logger,
    corsOrigins,
  } = deps;

  const app = Fastify({
    logger: false,
  });

  // CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  });

  // Rate limiting (global: 100 req/min per IP)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // WebSocket
  await app.register(websocket);

  // Auth middleware (must be registered before routes)
  registerAuthMiddleware(app, { authService, userManager, logger });

  // Register routes
  registerHealthRoutes(app, { deviceManager, integrationRegistry, logger });
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
  registerSettingsRoutes(app, { settingsManager, logger });
  registerIntegrationRoutes(app, { integrationRegistry, settingsManager, logger });
  registerButtonActionRoutes(app, { buttonActionManager, logger });
  registerLogRoutes(app, { logBuffer, logger });
  registerWebSocket(app, { eventBus, authService, logBuffer, logger });

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
