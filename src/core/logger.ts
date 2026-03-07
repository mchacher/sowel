import pino from "pino";
import { Writable } from "node:stream";
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
      options: {
        file: "data/logs/sowel",
        frequency: "daily",
        limit: { count: 14 },
        mkdir: true,
      },
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
