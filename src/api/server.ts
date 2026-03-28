import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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
import type { HistoryWriter } from "../history/history-writer.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { ChartManager } from "../charts/chart-manager.js";
import type { MqttBrokerManager } from "../mqtt-publishers/mqtt-broker-manager.js";
import type { MqttPublisherManager } from "../mqtt-publishers/mqtt-publisher-manager.js";
import type { MqttPublishService } from "../mqtt-publishers/mqtt-publish-service.js";
import type { NotificationPublisherManager } from "../notifications/notification-publisher-manager.js";
import type { NotificationPublishService } from "../notifications/notification-publish-service.js";
import type { PluginManager } from "../plugins/plugin-manager.js";
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
import { registerHistoryRoutes } from "./routes/history.js";
import { registerEnergyRoutes } from "./routes/energy.js";
import { registerChartRoutes } from "./routes/charts.js";
import { registerMqttBrokerRoutes } from "./routes/mqtt-brokers.js";
import { registerMqttPublisherRoutes } from "./routes/mqtt-publishers.js";
import { registerNotificationPublisherRoutes } from "./routes/notification-publishers.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerPluginRoutes } from "./routes/plugins.js";
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
  historyWriter: HistoryWriter;
  influxClient: InfluxClient;
  chartManager: ChartManager;
  mqttBrokerManager: MqttBrokerManager;
  mqttPublisherManager: MqttPublisherManager;
  mqttPublishService: MqttPublishService;
  notificationPublisherManager: NotificationPublisherManager;
  notificationPublishService: NotificationPublishService;
  pluginManager: PluginManager;
  eventBus: EventBus;
  integrationRegistry: IntegrationRegistry;
  logBuffer: LogRingBuffer;
  logger: Logger;
  corsOrigins: string[];
  dataDir: string;
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
    historyWriter,
    influxClient,
    chartManager,
    mqttBrokerManager,
    mqttPublisherManager,
    mqttPublishService,
    notificationPublisherManager,
    notificationPublishService,
    pluginManager,
    eventBus,
    integrationRegistry,
    logBuffer,
    logger,
    corsOrigins,
    dataDir,
  } = deps;

  const app = Fastify({
    logger: false,
  });

  // CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  });

  // Rate limiting (global: 300 req/min per IP — SPA makes many parallel calls)
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // Multipart file uploads (for backup restore)
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } }); // 500 MB

  // WebSocket
  await app.register(websocket);

  // Prevent browser caching on time-sensitive API routes
  const noCacheRoutes = ["/api/v1/energy/", "/api/v1/charts/", "/api/v1/logs"];
  app.addHook("onSend", (_req, reply, payload, done) => {
    if (noCacheRoutes.some((r) => _req.url.startsWith(r))) {
      reply.header("Cache-Control", "no-store");
    }
    done(null, payload);
  });

  // Auth middleware (must be registered before routes)
  registerAuthMiddleware(app, { authService, userManager, logger });

  // Register routes
  registerHealthRoutes(app, { deviceManager, integrationRegistry, logger });
  registerAuthRoutes(app, { authService, userManager, logger });
  registerMeRoutes(app, { authService, userManager, logger });
  registerUserRoutes(app, { userManager, logger });
  registerDeviceRoutes(app, { deviceManager, logger });
  registerZoneRoutes(app, { zoneManager, zoneAggregator, equipmentManager, logger });
  registerEquipmentRoutes(app, { equipmentManager, logger });
  registerRecipeRoutes(app, { recipeManager, logger });
  registerModeRoutes(app, { modeManager, buttonActionManager, logger });
  registerCalendarRoutes(app, { calendarManager, logger });
  registerBackupRoutes(app, { db, influxClient, logger, dataDir });
  registerSettingsRoutes(app, { settingsManager, eventBus, logger });
  registerIntegrationRoutes(app, {
    integrationRegistry,
    settingsManager,
    deviceManager,
    pluginManager,
    logger,
  });
  registerButtonActionRoutes(app, { buttonActionManager, logger });
  registerHistoryRoutes(app, {
    historyWriter,
    influxClient,
    equipmentManager,
    eventBus,
    logger,
  });
  registerChartRoutes(app, { chartManager });
  registerMqttBrokerRoutes(app, { mqttBrokerManager });
  registerMqttPublisherRoutes(app, { mqttPublisherManager, mqttPublishService });
  registerNotificationPublisherRoutes(app, {
    notificationPublisherManager,
    notificationPublishService,
  });
  registerEnergyRoutes(app, {
    equipmentManager,
    influxClient,
    settingsManager,
    tariffClassifier: historyWriter.getTariffClassifier(),
    logger,
  });
  registerDashboardRoutes(app, { db });
  registerPluginRoutes(app, { pluginManager, integrationRegistry, logger });
  registerLogRoutes(app, { logBuffer, logger });
  registerWebSocket(app, { eventBus, authService, logBuffer, logger });

  // Serve UI static files from project root ui-dist/
  const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const uiDir = resolve(currentDir, "../../ui-dist");
  if (existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: "/",
      wildcard: false,
    });

    // Prevent iOS from aggressively caching PWA manifest and icons
    app.addHook("onSend", (_req, reply, payload, done) => {
      const url = _req.url;
      if (
        url.endsWith(".webmanifest") ||
        url.endsWith("manifest.json") ||
        url.includes("apple-touch-icon") ||
        url.match(/pwa-.*\.png$/)
      ) {
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      done(null, payload);
    });

    // Serve static files (assets, service workers, fonts) and SPA fallback
    app.setNotFoundHandler((_req, reply) => {
      const pathname = _req.url.split("?")[0];
      if (/\.\w+$/.test(pathname)) {
        // Try serving as a static file from ui-dist
        void reply.sendFile(pathname.slice(1));
        return;
      }
      // SPA fallback for navigation routes (no file extension)
      void reply.sendFile("index.html");
    });

    logger.info(`Serving UI from ${uiDir}`);
  }

  return app;
}
