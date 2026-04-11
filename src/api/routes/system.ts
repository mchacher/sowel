import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { VersionChecker } from "../../core/version-checker.js";
import type { UpdateManager } from "../../core/update-manager.js";

export interface TzInfo {
  tz: string;
  source: "env" | "auto" | "fallback";
  offsetHours: number;
}

interface SystemDeps {
  versionChecker: VersionChecker;
  updateManager: UpdateManager;
  tzInfo: TzInfo;
  logger: Logger;
}

// Internal rate limit for /version/check (max 1 call per 10s, shared global)
const CHECK_NOW_MIN_INTERVAL_MS = 10_000;

export function registerSystemRoutes(app: FastifyInstance, deps: SystemDeps): void {
  const { versionChecker, updateManager, tzInfo, logger: parentLogger } = deps;
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
      return reply.code(400).send({
        error:
          "Docker socket not available. Update manually with: docker compose pull && docker compose up -d",
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

  // POST /api/v1/system/restart — trigger a container restart via helper
  // Used after home location change (to re-derive the timezone)
  app.post("/api/v1/system/restart", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    if (!updateManager.isDockerAvailable()) {
      return reply.code(400).send({
        error: "Docker socket not available. Restart manually with: docker compose restart sowel",
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
