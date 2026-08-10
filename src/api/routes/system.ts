import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { VersionChecker } from "../../core/version-checker.js";
import type { UpdateManager } from "../../core/update-manager.js";
import type { SunlightManager } from "../../zones/sunlight-manager.js";

export interface TzInfo {
  tz: string;
  source: "env" | "auto" | "fallback";
  offsetHours: number;
}

interface SystemDeps {
  versionChecker: VersionChecker;
  updateManager: UpdateManager;
  tzInfo: TzInfo;
  sunlightManager: SunlightManager;
  /** Spec 124 — surfaced via GET /api/v1/system/mode so the UI can render its banner. */
  shadowMode: boolean;
  /** Issue #401 — true when the database was restored from another deployment. */
  takeoverPending: boolean;
  confirmTakeover: () => void;
  requestRestart: () => void;
  logger: Logger;
}

// Internal rate limit for /version/check (max 1 call per 10s, shared global)
const CHECK_NOW_MIN_INTERVAL_MS = 10_000;

export function registerSystemRoutes(app: FastifyInstance, deps: SystemDeps): void {
  const {
    versionChecker,
    updateManager,
    tzInfo,
    sunlightManager,
    shadowMode,
    takeoverPending,
    confirmTakeover,
    requestRestart,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "system-routes" });

  let lastCheckNow = 0;

  // GET /api/v1/system/version — current + latest version info
  app.get("/api/v1/system/version", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    return versionChecker.getVersionInfo();
  });

  // POST /api/v1/system/version/check — force a fresh GitHub poll
  app.post("/api/v1/system/version/check", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const now = Date.now();
    if (now - lastCheckNow < CHECK_NOW_MIN_INTERVAL_MS) {
      const retryAfter = Math.ceil((CHECK_NOW_MIN_INTERVAL_MS - (now - lastCheckNow)) / 1000);
      return reply
        .code(429)
        .header("Retry-After", String(retryAfter))
        .send({ error: `Please wait ${retryAfter}s before checking again` });
    }
    lastCheckNow = now;

    try {
      const info = await versionChecker.checkNow();
      return info;
    } catch (err) {
      logger.error({ err }, "Manual version check failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Version check failed",
      });
    }
  });

  // POST /api/v1/system/update — trigger self-update via Docker
  app.post("/api/v1/system/update", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    if (!updateManager.isDockerAvailable()) {
      return reply.code(503).send({
        error:
          "In-app self-update is disabled because /var/run/docker.sock is not mounted. Enable it by copying docker-compose.override.example.yml to docker-compose.override.yml, or update manually with: docker compose pull && docker compose up -d",
      });
    }

    if (!updateManager.isComposeManaged()) {
      return reply.code(400).send({
        error:
          "Self-update requires docker compose. Update manually with: docker compose pull && docker compose up -d",
      });
    }

    if (updateManager.isUpdating()) {
      return reply.code(409).send({ error: "Update already in progress" });
    }

    const versionInfo = versionChecker.getVersionInfo();
    if (!versionInfo.updateAvailable || !versionInfo.latest) {
      return reply.code(400).send({ error: "No update available" });
    }

    // Start update in background (progress via WebSocket)
    updateManager.update(versionInfo.latest).catch((err) => {
      logger.error({ err }, "Self-update failed");
    });

    return { success: true, message: `Updating to v${versionInfo.latest}...` };
  });

  // GET /api/v1/system/timezone — current timezone info
  // Accessible to ANY authenticated user (needed by the CurrentTimePill in the header)
  app.get("/api/v1/system/timezone", async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    return tzInfo;
  });

  // GET /api/v1/system/mode — surfaces the shadow-mode flag so the UI
  // can render its sticky banner. Accessible to ANY authenticated user
  // (read-only, no PII). Spec 124. Issue #401 adds takeoverPending for
  // the restored-data guardrail banner.
  app.get("/api/v1/system/mode", async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    return { shadowMode, takeoverPending };
  });

  // POST /api/v1/system/takeover — adopt a database restored from another
  // deployment (issue #401). Writes the local instance marker, then restarts
  // the engine so every gated subsystem comes back armed. Admin only.
  app.post("/api/v1/system/takeover", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }
    if (!takeoverPending) {
      return reply.code(409).send({ error: "No takeover is pending" });
    }
    logger.warn({ userId: request.auth.userId }, "Takeover confirmed via API");
    confirmTakeover();
    requestRestart();
    return { ok: true, restarting: true };
  });

  // GET /api/v1/system/sunlight — current server time + daylight state
  //
  // Combines the SunlightManager's cached sunrise/sunset/isDaylight
  // with a fresh `now` ISO timestamp and the timezone snapshot so that
  // headless clients (the energy display firmware) can derive local
  // time and switch to a dimmed brightness profile after sunset
  // without running their own NTP client.
  //
  // Accessible to ANY authenticated user (read-only, no PII).
  app.get("/api/v1/system/sunlight", async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    const data = sunlightManager.getSunlightData();
    return {
      now: new Date().toISOString(),
      tz: tzInfo.tz,
      offsetHours: tzInfo.offsetHours,
      sunrise: data.sunrise,
      sunset: data.sunset,
      isDaylight: data.isDaylight,
    };
  });

  // POST /api/v1/system/restart — trigger a container restart via helper
  // Used after home location change (to re-derive the timezone)
  app.post("/api/v1/system/restart", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    if (!updateManager.isDockerAvailable()) {
      return reply.code(503).send({
        error:
          "In-app restart is disabled because /var/run/docker.sock is not mounted. Enable it by copying docker-compose.override.example.yml to docker-compose.override.yml, or restart manually with: docker compose restart sowel",
      });
    }

    if (!updateManager.isComposeManaged()) {
      return reply.code(400).send({
        error: "Sowel is not managed by docker compose. Restart manually.",
      });
    }

    if (updateManager.isUpdating()) {
      return reply.code(409).send({ error: "An operation is already in progress" });
    }

    // Start restart in background (progress via WebSocket)
    updateManager.restartViaHelper().catch((err) => {
      logger.error({ err }, "Restart-via-helper failed");
    });

    return { success: true, message: "Restarting Sowel..." };
  });
}
