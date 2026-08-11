import pino from "pino";
import { Writable } from "node:stream";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LogRingBuffer } from "./log-buffer.js";

export type Logger = pino.Logger;

const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "mqttPassword",
  "*.mqttPassword",
];

export interface LoggerHandle {
  logger: Logger;
  /** Flush buffers and close worker-thread transports. Call on shutdown. */
  close: () => Promise<void>;
}

/**
 * pino-roll options for the production file transport (#400).
 *
 * Date-stamped names (`sowel.2026-08-11.1.log`) make one calendar day map to
 * one predictable file across container restarts; bare rotation numbers used
 * to interleave days between files, which produced apparent gaps during
 * post-incident greps. `removeOtherLogFiles` makes the retention count apply
 * to files left by previous containers too — pino-roll otherwise only counts
 * files created by the current process, so old files were never cleaned.
 * Cleanup only touches files matching the base name + date + number pattern;
 * legacy `sowel.N.log` files and unrelated files in the folder are ignored.
 *
 * Exported for tests.
 */
export function fileTransportOptions(file = "data/logs/sowel"): {
  file: string;
  frequency: string;
  dateFormat: string;
  limit: { count: number; removeOtherLogFiles: boolean };
  mkdir: boolean;
} {
  return {
    file,
    frequency: "daily",
    dateFormat: "yyyy-MM-dd",
    limit: { count: 14, removeOtherLogFiles: true },
    mkdir: true,
  };
}

/** Retention window matching `fileTransportOptions().limit.count` days. */
const LEGACY_LOG_RETENTION_MS = 14 * 24 * 3600_000;

/** Pre-#400 rotation format: sowel.<number>.log, no date segment. */
const LEGACY_LOG_RE = /^sowel\.\d+\.log$/;

/**
 * One-shot migration purge (#400 follow-up): pino-roll's cleanup only
 * pattern-matches the new date-stamped format, so files rotated by versions
 * before the switch would sit on disk forever. Delete legacy-format files
 * older than the normal retention window; recent ones are kept so the last
 * two weeks of history stay greppable across the format change. Never
 * throws — a purge failure must not block boot.
 *
 * Exported for tests.
 */
export function purgeLegacyLogFiles(logger: Logger, dir = "data/logs"): void {
  try {
    if (!existsSync(dir)) return;
    const cutoff = Date.now() - LEGACY_LOG_RETENTION_MS;
    let removed = 0;
    let freedBytes = 0;
    for (const name of readdirSync(dir)) {
      if (!LEGACY_LOG_RE.test(name)) continue;
      const path = join(dir, name);
      const stats = statSync(path);
      if (stats.mtimeMs >= cutoff) continue;
      unlinkSync(path);
      removed++;
      freedBytes += stats.size;
    }
    if (removed > 0) {
      logger.info(
        { module: "logger", removed, freedMB: Math.round(freedBytes / 1_048_576) },
        "Purged legacy log files past the retention window",
      );
    }
  } catch (err) {
    logger.warn({ module: "logger", err }, "Legacy log purge failed");
  }
}

/**
 * Creates the pino logger with multistream output:
 * - stdout (pino-pretty in dev, raw JSON in prod)
 * - ring buffer (in-memory, always at debug level)
 * - file transport via pino-roll (production only, daily rotation)
 *
 * Returns a handle with the logger and a close() for graceful shutdown.
 */
export function createLogger(level: string, logBuffer?: LogRingBuffer): LoggerHandle {
  const isDev = process.env["NODE_ENV"] !== "production";

  // Build stream entries for multistream
  const streams: pino.StreamEntry[] = [];
  // Track transports (worker threads) that need closing
  const transports: NodeJS.WritableStream[] = [];

  // 1. Ring buffer stream — always captures at debug level
  if (logBuffer) {
    streams.push({
      stream: new Writable({
        write(chunk, _, cb) {
          try {
            logBuffer.push(JSON.parse(chunk.toString()));
          } catch {
            // Ignore non-JSON or parse errors
          }
          cb();
        },
      }),
      level: "debug",
    });
  }

  // 2. Console output
  if (isDev) {
    // Development: use pino-pretty via transport-like stream
    const transport = pino.transport({
      target: "pino-pretty",
      options: { colorize: true },
    });
    streams.push({
      stream: transport,
      level: level as pino.Level,
    });
    transports.push(transport);
  } else {
    // Production: raw JSON to stdout (captured by journald/Docker)
    streams.push({
      stream: process.stdout,
      level: level as pino.Level,
    });

    // 3. File transport via pino-roll (production only)
    const fileTransport = pino.transport({
      target: "pino-roll",
      options: fileTransportOptions(),
    });
    streams.push({
      stream: fileTransport,
      level: level as pino.Level,
    });
    transports.push(fileTransport);
  }

  // Root level = "debug" when ring buffer is present (so debug entries reach it)
  const rootLevel = logBuffer ? "debug" : level;

  const logger = pino(
    {
      level: rootLevel,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: REDACT_PATHS,
        censor: "[REDACTED]",
      },
    },
    pino.multistream(streams),
  );

  const close = async () => {
    logger.flush();
    for (const t of transports) {
      t.end();
    }
    // Give worker threads a moment to flush
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  return { logger, close };
}
