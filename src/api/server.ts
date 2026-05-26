import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { Logger } from "../core/logger.js";
import type { LogRingBuffer } from "../core/log-buffer.js";
import type { ActivityBuffer } from "../activity/activity-buffer.js";
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
import type { PackageManager } from "../packages/package-manager.js";
import type { PluginLoader } from "../plugins/plugin-loader.js";
import type { BackupManager } from "../backup/backup-manager.js";
import type { SunlightManager } from "../zones/sunlight-manager.js";
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
import { registerActivityRoutes } from "./routes/activity.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerEnergyRoutes } from "./routes/energy.js";
import { registerChartRoutes } from "./routes/charts.js";
import { registerMqttBrokerRoutes } from "./routes/mqtt-brokers.js";
import { registerMqttPublisherRoutes } from "./routes/mqtt-publishers.js";
import { registerNotificationPublisherRoutes } from "./routes/notification-publishers.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerPluginRoutes } from "./routes/plugins.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerAuditRoutes } from "./routes/audit.js";
import type { AuditLogger } from "../core/audit-logger.js";
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
  packageManager: PackageManager;
  pluginLoader: PluginLoader;
  recipeLoader: import("../recipes/recipe-loader.js").RecipeLoader;
  backupManager: BackupManager;
  versionChecker: import("../core/version-checker.js").VersionChecker;
  updateManager: import("../core/update-manager.js").UpdateManager;
  tzInfo: {
    tz: string;
    source: "env" | "auto" | "fallback";
    offsetHours: number;
  };
  sunlightManager: SunlightManager;
  eventBus: EventBus;
  integrationRegistry: IntegrationRegistry;
  logBuffer: LogRingBuffer;
  activityBuffer: ActivityBuffer;
  auditLogger: AuditLogger;
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
    sunlightManager,
    eventBus,
    integrationRegistry,
    logBuffer,
    activityBuffer,
    auditLogger,
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

  // Security headers (CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options).
  // HSTS is set conditionally below (HTTPS only) to avoid breaking local HTTP setups.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Google Fonts CSS (`fonts.googleapis.com`) is loaded as a stylesheet
        // from ui/index.html for the Nunito heading font.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        // Font files: own bundle (Inter is inlined as `data:` URIs by Vite)
        // plus `fonts.gstatic.com` for the Nunito heading font loaded by index.html.
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Helmet sets this by default. We disable it because most Sowel
        // deployments are LAN-only on plain HTTP — forcing HTTPS would
        // break asset loading. Reverse proxies that terminate TLS still
        // benefit from the conditional HSTS header below.
        "upgrade-insecure-requests": null,
      },
    },
    strictTransportSecurity: false,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    noSniff: true,
  });

  // HSTS only when the request arrived over HTTPS (via reverse proxy or direct TLS).
  app.addHook("onSend", (req, reply, payload, done) => {
    const xfProto = req.headers["x-forwarded-proto"];
    const proto =
      (Array.isArray(xfProto) ? xfProto[0] : xfProto) ??
      ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
    if (proto === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    done(null, payload);
  });

  // Rate limiting (global: 300 req/min per IP — SPA makes many parallel calls)
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // Multipart file uploads (for backup restore)
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } }); // 500 MB

  // WebSocket — confirm the `bearer.<token>` subprotocol on handshake so that
  // browsers don't drop the connection. Other subprotocols are refused.
  await app.register(websocket, {
    options: {
      handleProtocols: (protocols: Set<string> | string[]) => {
        const list = protocols instanceof Set ? Array.from(protocols) : protocols;
        const bearer = list.find((p) => p.startsWith("bearer."));
        return bearer ?? false;
      },
    },
  });

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
  registerAuthRoutes(app, { authService, userManager, auditLogger, logger });
  registerMeRoutes(app, { authService, userManager, auditLogger, logger });
  registerUserRoutes(app, { userManager, auditLogger, logger });
  registerDeviceRoutes(app, { deviceManager, logger });
  registerZoneRoutes(app, { zoneManager, zoneAggregator, equipmentManager, logger });
  registerEquipmentRoutes(app, { equipmentManager, logger });
  registerRecipeRoutes(app, { recipeManager, logger });
  registerModeRoutes(app, { modeManager, buttonActionManager, auditLogger, userManager, logger });
  registerCalendarRoutes(app, { calendarManager, logger });
  registerBackupRoutes(app, { backupManager, auditLogger, userManager, logger });
  registerSettingsRoutes(app, {
    settingsManager,
    eventBus,
    auditLogger,
    userManager,
    logger,
  });
  registerIntegrationRoutes(app, {
    integrationRegistry,
    settingsManager,
    deviceManager,
    pluginLoader,
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
  registerPluginRoutes(app, {
    packageManager,
    pluginLoader,
    recipeLoader,
    integrationRegistry,
    auditLogger,
    userManager,
    logger,
  });
  registerAuditRoutes(app, { auditLogger, logger });
  registerSystemRoutes(app, {
    versionChecker,
    updateManager,
    tzInfo,
    sunlightManager,
    logger,
  });
  registerLogRoutes(app, { logBuffer, logger });
  registerActivityRoutes(app, { activityBuffer, logger });
  registerWebSocket(app, { eventBus, authService, logBuffer, logger, corsOrigins });

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
