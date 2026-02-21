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

export function loadConfig(): AppConfig {
  const sqlitePath = env("SQLITE_PATH", "./data/corbel.db");
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
  };
}
