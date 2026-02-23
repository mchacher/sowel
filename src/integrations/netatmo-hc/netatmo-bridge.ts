/**
 * NetatmoBridge — HTTP client for the Netatmo Connect API.
 *
 * Handles OAuth2 token management (refresh rotation + persistence)
 * and provides methods for homesdata, homestatus, and setstate.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Logger } from "../../core/logger.js";
import type {
  NetatmoTokenResponse,
  NetatmoHomesDataResponse,
  NetatmoHomeStatusResponse,
  NetatmoSetStateRequest,
} from "./netatmo-types.js";

const BASE_URL = "https://api.netatmo.com";
const REQUEST_TIMEOUT_MS = 30_000;
const REFRESH_MARGIN_S = 300; // Refresh 5 min before expiry

export class NetatmoBridge {
  private logger: Logger;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private refreshToken: string;
  private tokenExpiresAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenFilePath: string;
  private onRefreshTokenUpdated: ((newToken: string) => void) | null = null;

  constructor(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    logger: Logger,
    dataDir: string,
    onRefreshTokenUpdated?: (newToken: string) => void,
  ) {
    this.logger = logger.child({ module: "netatmo-bridge" });
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.tokenFilePath = path.join(dataDir, "netatmo-tokens.json");
    this.onRefreshTokenUpdated = onRefreshTokenUpdated ?? null;

    // Restore tokens from file if available
    this.loadTokensFromFile();
  }

  // ============================================================
  // Token management
  // ============================================================

  /** Initial token refresh — must be called before any API call. */
  async authenticate(): Promise<void> {
    await this.doRefreshToken();
    this.scheduleRefresh();
  }

  /** Stop the automatic refresh timer. */
  disconnect(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.accessToken = null;
  }

  private async doRefreshToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await this.rawFetch(`${BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as NetatmoTokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    // Persist immediately
    this.saveTokensToFile();

    // Notify plugin so it can persist refresh_token to settings
    if (this.onRefreshTokenUpdated) {
      this.onRefreshTokenUpdated(data.refresh_token);
    }

    this.logger.info({ expiresIn: data.expires_in }, "Netatmo access token refreshed");
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    const msUntilExpiry = this.tokenExpiresAt - Date.now();
    const msUntilRefresh = Math.max(
      msUntilExpiry - REFRESH_MARGIN_S * 1000,
      60_000, // At least 1 min from now
    );

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.doRefreshToken();
        this.scheduleRefresh();
      } catch (err) {
        this.logger.warn({ err }, "Token refresh failed, retrying in 30s");
        // Retry once after 30s
        this.refreshTimer = setTimeout(async () => {
          try {
            await this.doRefreshToken();
            this.scheduleRefresh();
          } catch (retryErr) {
            this.logger.error(
              { err: retryErr },
              "Token refresh retry failed — bridge is now unauthenticated",
            );
          }
        }, 30_000);
      }
    }, msUntilRefresh);
  }

  private loadTokensFromFile(): void {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        const raw = fs.readFileSync(this.tokenFilePath, "utf-8");
        const saved = JSON.parse(raw) as {
          refreshToken?: string;
          accessToken?: string;
          expiresAt?: number;
        };
        if (saved.refreshToken) {
          this.refreshToken = saved.refreshToken;
          this.logger.debug("Loaded refresh token from file");
        }
        if (saved.accessToken && saved.expiresAt && saved.expiresAt > Date.now()) {
          this.accessToken = saved.accessToken;
          this.tokenExpiresAt = saved.expiresAt;
          this.logger.debug("Loaded valid access token from file");
        }
      }
    } catch {
      this.logger.debug("No saved tokens found, will use configured refresh_token");
    }
  }

  private saveTokensToFile(): void {
    try {
      const dir = path.dirname(this.tokenFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.tokenFilePath,
        JSON.stringify({
          refreshToken: this.refreshToken,
          accessToken: this.accessToken,
          expiresAt: this.tokenExpiresAt,
        }),
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to persist Netatmo tokens");
    }
  }

  // ============================================================
  // API methods
  // ============================================================

  async getHomesData(): Promise<NetatmoHomesDataResponse> {
    return this.apiGet<NetatmoHomesDataResponse>("/api/homesdata");
  }

  async getHomeStatus(homeId: string): Promise<NetatmoHomeStatusResponse> {
    return this.apiGet<NetatmoHomeStatusResponse>(
      `/api/homestatus?home_id=${encodeURIComponent(homeId)}`,
    );
  }

  async setState(request: NetatmoSetStateRequest): Promise<void> {
    const res = await this.apiFetch(`${BASE_URL}/api/setstate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`setstate failed (${res.status}): ${text}`);
    }
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  private async apiGet<T>(endpoint: string): Promise<T> {
    const res = await this.apiFetch(`${BASE_URL}${endpoint}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${endpoint} failed (${res.status}): ${text}`);
    }

    return (await res.json()) as T;
  }

  private async apiFetch(url: string, init: RequestInit): Promise<Response> {
    // Auto-refresh if token is expired or about to expire
    if (this.accessToken && this.tokenExpiresAt > 0 && Date.now() > this.tokenExpiresAt - 60_000) {
      this.logger.debug("Access token about to expire, refreshing now");
      await this.doRefreshToken();
      // Update Authorization header with new token
      if (init.headers && typeof init.headers === "object" && "Authorization" in init.headers) {
        (init.headers as Record<string, string>).Authorization = `Bearer ${this.accessToken}`;
      }
    }

    return this.rawFetch(url, init);
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
