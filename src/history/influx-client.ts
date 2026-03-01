import { InfluxDB, Point } from "@influxdata/influxdb-client";
import type { WriteApi } from "@influxdata/influxdb-client";
import type { Logger } from "../core/logger.js";

export interface InfluxConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

/**
 * Thin wrapper around the InfluxDB 2.x client.
 * Provides connect, disconnect, health check, and buffered write.
 */
export class InfluxClient {
  private logger: Logger;
  private client: InfluxDB | null = null;
  private writeApi: WriteApi | null = null;
  private config: InfluxConfig | null = null;
  private _connected = false;

  /** Counters for /api/v1/history/status */
  private pointsWritten24h = 0;
  private errors24h = 0;
  private counterResetAt = Date.now();

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "influx-client" });
  }

  /**
   * Connect to InfluxDB with the given config.
   * Initializes the write API with batch settings.
   */
  connect(config: InfluxConfig): void {
    this.disconnect();

    this.config = config;
    this.client = new InfluxDB({
      url: config.url,
      token: config.token,
    });

    this.writeApi = this.client.getWriteApi(config.org, config.bucket, "s", {
      batchSize: 100,
      flushInterval: 5000,
      maxRetries: 3,
      retryJitter: 200,
    });

    this._connected = true;
    this.logger.info(
      { url: config.url, org: config.org, bucket: config.bucket },
      "InfluxDB client connected",
    );
  }

  /** Flush pending writes and close the client. */
  async disconnect(): Promise<void> {
    if (this.writeApi) {
      try {
        await this.writeApi.close();
      } catch (err) {
        this.logger.warn({ err }, "Error flushing InfluxDB write buffer on disconnect");
      }
      this.writeApi = null;
    }
    this.client = null;
    this._connected = false;
    this.config = null;
  }

  isConnected(): boolean {
    return this._connected;
  }

  /** Health check: ping InfluxDB. Returns true if reachable. */
  async ping(): Promise<boolean> {
    if (!this.config) return false;
    try {
      const response = await fetch(`${this.config.url}/ping`);
      return response.ok || response.status === 204;
    } catch {
      return false;
    }
  }

  /** Buffer a single data point. Non-blocking, fire-and-forget. */
  writePoint(point: Point): void {
    if (!this.writeApi) {
      this.logger.debug("writePoint called but writeApi not initialized — skipping");
      return;
    }
    try {
      this.writeApi.writePoint(point);
      this.tickPointWritten();
    } catch (err) {
      this.tickError();
      this.logger.warn({ err }, "Error buffering InfluxDB point");
    }
  }

  /** Force flush buffered writes. */
  async flush(): Promise<void> {
    if (!this.writeApi) return;
    try {
      await this.writeApi.flush();
    } catch (err) {
      this.tickError();
      this.logger.warn({ err }, "Error flushing InfluxDB write buffer");
    }
  }

  /** Get 24h stats (auto-resets after 24h). */
  getStats(): { pointsWritten24h: number; errors24h: number } {
    this.maybeResetCounters();
    return { pointsWritten24h: this.pointsWritten24h, errors24h: this.errors24h };
  }

  private tickPointWritten(): void {
    this.maybeResetCounters();
    this.pointsWritten24h++;
  }

  private tickError(): void {
    this.maybeResetCounters();
    this.errors24h++;
  }

  private maybeResetCounters(): void {
    const now = Date.now();
    if (now - this.counterResetAt > 86_400_000) {
      this.pointsWritten24h = 0;
      this.errors24h = 0;
      this.counterResetAt = now;
    }
  }
}

// Re-export Point for convenience
export { Point };
