import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import type { AppConfig } from "./shared/types.js";

dotenvConfig();

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${raw}`);
  }
  return parsed;
}

/**
 * Resolve or auto-generate the JWT secret.
 * Priority: JWT_SECRET env var > persisted file > generate new.
 */
function resolveJwtSecret(dataDir: string): string {
  const fromEnv = process.env["JWT_SECRET"];
  if (fromEnv) return fromEnv;

  const secretPath = resolve(dataDir, ".jwt-secret");
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, "utf-8").trim();
  }

  // First launch — generate and persist
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

/**
 * Default InfluxDB admin token — matches DOCKER_INFLUXDB_INIT_ADMIN_TOKEN
 * in docker-compose.yml. On a fresh install, both InfluxDB and Sowel use
 * this token out of the box. Override with INFLUX_TOKEN env var or
 * data/.influx-token file for custom setups.
 */
const DEFAULT_INFLUX_TOKEN =
  "Uvht0Iez4HD5xu1BwhLFe9PI-ODIX9pTTdgYoNq1PQeSL2x3UKXHHRcQq5D-f2rkc0pnJGriuTzbO-kJKP3O8w==";

/**
 * Resolve the InfluxDB token.
 * Priority: INFLUX_TOKEN env var > persisted file > default (docker-compose token).
 */
function resolveInfluxToken(dataDir: string): string {
  const fromEnv = process.env["INFLUX_TOKEN"];
  if (fromEnv) return fromEnv;

  const tokenPath = resolve(dataDir, ".influx-token");
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim();
  }

  return DEFAULT_INFLUX_TOKEN;
}

export function loadConfig(): AppConfig {
  const sqlitePath = env("SQLITE_PATH", "./data/sowel.db");
  const dataDir = dirname(resolve(sqlitePath));

  return {
    sqlite: {
      path: sqlitePath,
    },
    api: {
      port: envInt("API_PORT", 3000),
      host: env("API_HOST", "0.0.0.0"),
    },
    jwt: {
      secret: resolveJwtSecret(dataDir),
      accessTtl: envInt("JWT_ACCESS_TTL", 900),
      refreshTtl: envInt("JWT_REFRESH_TTL", 2592000),
    },
    log: {
      level: env("LOG_LEVEL", "info"),
    },
    cors: {
      origins: env("CORS_ORIGINS", "*")
        .split(",")
        .map((s) => s.trim()),
    },
    influx: {
      url: env("INFLUX_URL", "http://localhost:8086"),
      token: resolveInfluxToken(dataDir),
      org: env("INFLUX_ORG", "sowel"),
      bucket: env("INFLUX_BUCKET", "sowel"),
    },
  };
}
