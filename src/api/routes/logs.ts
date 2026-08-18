import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { LogRingBuffer } from "../../core/log-buffer.js";
import type { LogLevel } from "../../shared/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";

const VALID_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "fatal", "silent"];

// The runtime log level must be one of VALID_LEVELS. The enum rejects a missing
// or invalid level exactly like the old `!level || !VALID_LEVELS.includes(...)`
// check; admin gating is an onRequest hook so 403 still precedes 400.
const logLevelBodySchema = {
  type: "object",
  required: ["level"],
  properties: { level: { type: "string", enum: VALID_LEVELS } },
} as const;

interface LogsDeps {
  logBuffer: LogRingBuffer;
  logger: Logger;
}

export function registerLogRoutes(app: FastifyInstance, deps: LogsDeps): void {
  const { logBuffer, logger: rootLogger } = deps;
  const logger = rootLogger.child({ module: "logs-routes" });

  // All log routes are admin-only. The hook runs before body-schema validation,
  // preserving the original 403-before-400 ordering. Bounded to the /logs
  // subtree (exact path or a `/`-separated child) so it can't over-match a
  // future sibling route that merely shares the "logs" prefix.
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/api/v1/logs" || path.startsWith("/api/v1/logs/")) {
      requireAdmin(request, reply);
    }
  });

  // GET /api/v1/logs — Query ring buffer
  app.get<{
    Querystring: {
      limit?: string;
      level?: string;
      module?: string;
      search?: string;
      since?: string;
    };
  }>("/api/v1/logs", async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 2000);
    const { level, module, search, since } = request.query;

    const entries = logBuffer.query({ limit, level, module, search, since });

    return {
      entries,
      total: entries.length,
      capacity: logBuffer.getCapacity(),
      currentLevel: rootLogger.level,
      modules: logBuffer.getModules(),
    };
  });

  // GET /api/v1/logs/level — Get current log level
  app.get("/api/v1/logs/level", async () => {
    return { level: rootLogger.level };
  });

  // PUT /api/v1/logs/level — Change runtime log level
  app.put<{ Body: { level: string } }>(
    "/api/v1/logs/level",
    { schema: { body: logLevelBodySchema } },
    async (request) => {
      const { level } = request.body;

      const previous = rootLogger.level;
      rootLogger.level = level;
      logger.info({ level, previous }, "Log level changed");

      return { level, previous };
    },
  );
}
