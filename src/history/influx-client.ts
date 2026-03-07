import { InfluxDB, Point } from "@influxdata/influxdb-client";
import type { WriteApi } from "@influxdata/influxdb-client";
import type { Logger } from "../core/logger.js";

export interface InfluxConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

/** Default retention durations in seconds. */
export const DEFAULT_RETENTION = {
  raw: 7 * 86_400, // 7 days
  hourly: 90 * 86_400, // 90 days
  daily: 5 * 365 * 86_400, // 5 years
} as const;

export interface RetentionStatus {
  buckets: {
    raw: { name: string; retentionSeconds: number } | null;
    hourly: { name: string; retentionSeconds: number } | null;
    daily: { name: string; retentionSeconds: number } | null;
  };
  tasks: {
    hourly: { id: string; status: string; lastRunAt?: string } | null;
    daily: { id: string; status: string; lastRunAt?: string } | null;
  };
  setupComplete: boolean;
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

  /**
   * Health check: ping InfluxDB and validate token.
   * Returns { reachable, authenticated } so the caller can report specific errors.
   */
  async ping(): Promise<boolean> {
    const detail = await this.pingDetail();
    return detail.reachable && detail.authenticated;
  }

  /**
   * Detailed health check with separate reachability and auth status.
   */
  async pingDetail(): Promise<{ reachable: boolean; authenticated: boolean }> {
    if (!this.config) return { reachable: false, authenticated: false };
    try {
      // 1. Check reachability (unauthenticated)
      const pingResp = await fetch(`${this.config.url}/ping`);
      if (!pingResp.ok && pingResp.status !== 204) {
        return { reachable: false, authenticated: false };
      }

      // 2. Validate token by querying orgs
      const authResp = await fetch(
        `${this.config.url}/api/v2/orgs?org=${encodeURIComponent(this.config.org)}`,
        { headers: { Authorization: `Token ${this.config.token}` } },
      );
      return { reachable: true, authenticated: authResp.ok };
    } catch {
      return { reachable: false, authenticated: false };
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

  /** Get the current config (org/bucket needed by query builder). */
  getConfig(): InfluxConfig | null {
    return this.config;
  }

  /** Get underlying InfluxDB client instance (for queries). */
  getClient(): InfluxDB | null {
    return this.client;
  }

  /** Get 24h stats (auto-resets after 24h). */
  getStats(): { pointsWritten24h: number; errors24h: number } {
    this.maybeResetCounters();
    return { pointsWritten24h: this.pointsWritten24h, errors24h: this.errors24h };
  }

  // ============================================================
  // Bucket & Task Management (IT5: Retention & Downsampling)
  // ============================================================

  /**
   * Ensure downsampling buckets exist with correct retention.
   * Idempotent: skips creation if bucket already exists.
   */
  async ensureBuckets(retention?: {
    rawSeconds?: number;
    hourlySeconds?: number;
    dailySeconds?: number;
  }): Promise<void> {
    if (!this.config) return;

    const rawRetention = retention?.rawSeconds ?? DEFAULT_RETENTION.raw;
    const hourlyRetention = retention?.hourlySeconds ?? DEFAULT_RETENTION.hourly;
    const dailyRetention = retention?.dailySeconds ?? DEFAULT_RETENTION.daily;

    try {
      const orgId = await this.getOrgId();
      if (!orgId) {
        this.logger.warn("Could not resolve InfluxDB org ID — skipping bucket setup");
        return;
      }

      // Ensure hourly and daily buckets exist
      await this.ensureBucket(`${this.config.bucket}-hourly`, hourlyRetention, orgId);
      await this.ensureBucket(`${this.config.bucket}-daily`, dailyRetention, orgId);

      // Update raw bucket retention (if currently 0 = infinite)
      await this.updateBucketRetention(this.config.bucket, rawRetention, orgId);

      this.logger.info(
        {
          rawDays: rawRetention / 86_400,
          hourlyDays: hourlyRetention / 86_400,
          dailyDays: dailyRetention / 86_400,
        },
        "Downsampling buckets configured",
      );
    } catch (err) {
      this.logger.warn(
        { err },
        "Failed to ensure downsampling buckets — continuing without retention management",
      );
    }
  }

  /**
   * Ensure downsampling Flux tasks exist.
   * Creates two tasks: hourly (raw→hourly) and daily (hourly→daily).
   * Idempotent: skips creation if task with same name already exists.
   */
  async ensureDownsamplingTasks(): Promise<void> {
    if (!this.config) return;

    try {
      const orgId = await this.getOrgId();
      if (!orgId) {
        this.logger.warn("Could not resolve InfluxDB org ID — skipping task setup");
        return;
      }

      const rawBucket = this.config.bucket;
      const hourlyBucket = `${rawBucket}-hourly`;
      const dailyBucket = `${rawBucket}-daily`;
      const org = this.config.org;

      // Hourly downsampling task
      const hourlyFlux = buildDownsampleHourlyFlux(rawBucket, hourlyBucket, org);
      await this.ensureTask("sowel-downsample-hourly", hourlyFlux, orgId);

      // Daily downsampling task
      const dailyFlux = buildDownsampleDailyFlux(hourlyBucket, dailyBucket, org);
      await this.ensureTask("sowel-downsample-daily", dailyFlux, orgId);

      this.logger.info("Downsampling tasks configured");
    } catch (err) {
      this.logger.warn(
        { err },
        "Failed to ensure downsampling tasks — continuing without auto-downsampling",
      );
    }
  }

  /**
   * Get current retention & downsampling status for the API.
   */
  async getRetentionStatus(): Promise<RetentionStatus> {
    const empty: RetentionStatus = {
      buckets: { raw: null, hourly: null, daily: null },
      tasks: { hourly: null, daily: null },
      setupComplete: false,
    };
    if (!this.config) return empty;

    try {
      const [buckets, tasks] = await Promise.all([this.listBuckets(), this.listTasks()]);

      const rawBucket = buckets.find((b) => b.name === this.config!.bucket);
      const hourlyBucket = buckets.find((b) => b.name === `${this.config!.bucket}-hourly`);
      const dailyBucket = buckets.find((b) => b.name === `${this.config!.bucket}-daily`);

      const hourlyTask = tasks.find((t) => t.name === "sowel-downsample-hourly");
      const dailyTask = tasks.find((t) => t.name === "sowel-downsample-daily");

      const result: RetentionStatus = {
        buckets: {
          raw: rawBucket
            ? { name: rawBucket.name, retentionSeconds: rawBucket.retentionSeconds }
            : null,
          hourly: hourlyBucket
            ? { name: hourlyBucket.name, retentionSeconds: hourlyBucket.retentionSeconds }
            : null,
          daily: dailyBucket
            ? { name: dailyBucket.name, retentionSeconds: dailyBucket.retentionSeconds }
            : null,
        },
        tasks: {
          hourly: hourlyTask
            ? {
                id: hourlyTask.id,
                status: hourlyTask.status,
                lastRunAt: hourlyTask.latestCompleted,
              }
            : null,
          daily: dailyTask
            ? { id: dailyTask.id, status: dailyTask.status, lastRunAt: dailyTask.latestCompleted }
            : null,
        },
        setupComplete: !!hourlyBucket && !!dailyBucket && !!hourlyTask && !!dailyTask,
      };

      return result;
    } catch (err) {
      this.logger.debug({ err }, "Failed to fetch retention status");
      return empty;
    }
  }

  // ============================================================
  // Private: InfluxDB v2 HTTP API helpers
  // ============================================================

  private async getOrgId(): Promise<string | null> {
    if (!this.config) return null;
    try {
      const resp = await fetch(
        `${this.config.url}/api/v2/orgs?org=${encodeURIComponent(this.config.org)}`,
        {
          headers: { Authorization: `Token ${this.config.token}` },
        },
      );
      if (!resp.ok) return null;
      const body = (await resp.json()) as { orgs?: Array<{ id: string }> };
      return body.orgs?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async listBuckets(): Promise<
    Array<{ id: string; name: string; retentionSeconds: number }>
  > {
    if (!this.config) return [];
    try {
      const resp = await fetch(`${this.config.url}/api/v2/buckets?limit=100`, {
        headers: { Authorization: `Token ${this.config.token}` },
      });
      if (!resp.ok) return [];
      const body = (await resp.json()) as {
        buckets?: Array<{
          id: string;
          name: string;
          retentionRules?: Array<{ everySeconds: number }>;
        }>;
      };
      return (body.buckets ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        retentionSeconds: b.retentionRules?.[0]?.everySeconds ?? 0,
      }));
    } catch {
      return [];
    }
  }

  private async ensureBucket(name: string, retentionSeconds: number, orgId: string): Promise<void> {
    if (!this.config) return;

    // Check if already exists
    const existing = await this.listBuckets();
    const found = existing.find((b) => b.name === name);
    if (found) {
      // Update retention if different
      if (found.retentionSeconds !== retentionSeconds) {
        await this.updateBucketRetentionById(found.id, retentionSeconds);
        this.logger.debug({ bucket: name, retentionSeconds }, "Updated bucket retention");
      }
      return;
    }

    // Create bucket
    const resp = await fetch(`${this.config.url}/api/v2/buckets`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        orgID: orgId,
        retentionRules: [{ type: "expire", everySeconds: retentionSeconds }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      this.logger.warn(
        { bucket: name, status: resp.status, body: text },
        "Failed to create bucket",
      );
      return;
    }

    this.logger.info({ bucket: name, retentionDays: retentionSeconds / 86_400 }, "Bucket created");
  }

  private async updateBucketRetention(
    name: string,
    retentionSeconds: number,
    orgId: string,
  ): Promise<void> {
    if (!this.config) return;
    // Find bucket by name
    const buckets = await this.listBuckets();
    const bucket = buckets.find((b) => b.name === name);
    if (!bucket) {
      this.logger.debug({ bucket: name, orgId }, "Bucket not found for retention update");
      return;
    }
    if (bucket.retentionSeconds === retentionSeconds) return; // Already correct
    await this.updateBucketRetentionById(bucket.id, retentionSeconds);
    this.logger.debug({ bucket: name, retentionSeconds }, "Updated raw bucket retention");
  }

  private async updateBucketRetentionById(
    bucketId: string,
    retentionSeconds: number,
  ): Promise<void> {
    if (!this.config) return;
    await fetch(`${this.config.url}/api/v2/buckets/${bucketId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Token ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        retentionRules: [{ type: "expire", everySeconds: retentionSeconds }],
      }),
    });
  }

  private async listTasks(): Promise<
    Array<{ id: string; name: string; status: string; latestCompleted?: string }>
  > {
    if (!this.config) return [];
    try {
      const resp = await fetch(`${this.config.url}/api/v2/tasks?limit=100`, {
        headers: { Authorization: `Token ${this.config.token}` },
      });
      if (!resp.ok) return [];
      const body = (await resp.json()) as {
        tasks?: Array<{
          id: string;
          name: string;
          status: string;
          latestCompleted?: string;
        }>;
      };
      return body.tasks ?? [];
    } catch {
      return [];
    }
  }

  private async ensureTask(name: string, flux: string, orgId: string): Promise<void> {
    if (!this.config) return;

    // Check if already exists
    const tasks = await this.listTasks();
    if (tasks.some((t) => t.name === name)) {
      this.logger.debug({ task: name }, "Downsampling task already exists");
      return;
    }

    const resp = await fetch(`${this.config.url}/api/v2/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orgID: orgId,
        flux,
        status: "active",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      this.logger.warn(
        { task: name, status: resp.status, body: text },
        "Failed to create downsampling task",
      );
      return;
    }

    this.logger.info({ task: name }, "Downsampling task created");
  }

  // ============================================================
  // Private: counters
  // ============================================================

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

// ============================================================
// Flux task definitions
// ============================================================

function buildDownsampleHourlyFlux(rawBucket: string, hourlyBucket: string, org: string): string {
  return `option task = {name: "sowel-downsample-hourly", every: 1h}

data = from(bucket: "${rawBucket}")
  |> range(start: -task.every)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r._field == "value_number")

mean_data = data
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> set(key: "_field", value: "mean")

min_data = data
  |> aggregateWindow(every: 1h, fn: min, createEmpty: false)
  |> set(key: "_field", value: "min")

max_data = data
  |> aggregateWindow(every: 1h, fn: max, createEmpty: false)
  |> set(key: "_field", value: "max")

union(tables: [mean_data, min_data, max_data])
  |> to(bucket: "${hourlyBucket}", org: "${org}")`;
}

function buildDownsampleDailyFlux(hourlyBucket: string, dailyBucket: string, org: string): string {
  return `option task = {name: "sowel-downsample-daily", every: 1d}

data = from(bucket: "${hourlyBucket}")
  |> range(start: -task.every)
  |> filter(fn: (r) => r._measurement == "equipment_data")

mean_data = data
  |> filter(fn: (r) => r._field == "mean")
  |> aggregateWindow(every: 1d, fn: mean, createEmpty: false)
  |> set(key: "_field", value: "mean")

min_data = data
  |> filter(fn: (r) => r._field == "min")
  |> aggregateWindow(every: 1d, fn: min, createEmpty: false)
  |> set(key: "_field", value: "min")

max_data = data
  |> filter(fn: (r) => r._field == "max")
  |> aggregateWindow(every: 1d, fn: max, createEmpty: false)
  |> set(key: "_field", value: "max")

union(tables: [mean_data, min_data, max_data])
  |> to(bucket: "${dailyBucket}", org: "${org}")`;
}

// Re-export Point for convenience
export { Point };
