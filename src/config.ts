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

export function loadConfig(): AppConfig {
  return {
    mqtt: {
      url: env("MQTT_URL", "mqtt://localhost:1883"),
      username: process.env["MQTT_USERNAME"] || undefined,
      password: process.env["MQTT_PASSWORD"] || undefined,
      clientId: env("MQTT_CLIENT_ID", "corbel"),
    },
    z2m: {
      baseTopic: env("Z2M_BASE_TOPIC", "zigbee2mqtt"),
    },
    sqlite: {
      path: env("SQLITE_PATH", "./data/corbel.db"),
    },
    api: {
      port: envInt("API_PORT", 3000),
      host: env("API_HOST", "0.0.0.0"),
    },
    jwt: {
      secret: env("JWT_SECRET", "corbel-dev-secret-change-me"),
      accessTtl: envInt("JWT_ACCESS_TTL", 900),
      refreshTtl: envInt("JWT_REFRESH_TTL", 2592000),
    },
    log: {
      level: env("LOG_LEVEL", "info"),
    },
    cors: {
      origins: env("CORS_ORIGINS", "http://localhost:5173")
        .split(",")
        .map((s) => s.trim()),
    },
  };
}
