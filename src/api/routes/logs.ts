import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { LogRingBuffer } from "../../core/log-buffer.js";
import type { LogLevel } from "../../shared/types.js";

const VALID_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "fatal", "silent"];

interface LogsDeps {
  logBuffer: LogRingBuffer;
  logger: Logger;
}

export function registerLogRoutes(app: FastifyInstance, deps: LogsDeps): void {
  const { logBuffer, logger: rootLogger } = deps;
  const logger = rootLogger.child({ module: "logs-routes" });

  // GET /api/v1/logs — Query ring buffer
  app.get<{
    Querystring: {
      limit?: string;
      level?: string;
      module?: string;
      search?: string;
      since?: string;
    };
  }>("/api/v1/logs", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

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
  app.get("/api/v1/logs/level", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    return { level: rootLogger.level };
  });

  // PUT /api/v1/logs/level — Change runtime log level
  app.put<{ Body: { level: string } }>("/api/v1/logs/level", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const { level } = request.body ?? {};
    if (!level || !VALID_LEVELS.includes(level as LogLevel)) {
      return reply.code(400).send({
        error: `Invalid level. Must be one of: ${VALID_LEVELS.join(", ")}`,
      });
    }

    const previous = rootLogger.level;
    rootLogger.level = level;
    logger.info({ level, previous }, "Log level changed");

    return { level, previous };
  });
}
