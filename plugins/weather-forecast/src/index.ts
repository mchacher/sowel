/**
 * Sowel Plugin — Weather Forecast
 *
 * Provides current weather conditions and daily forecast data
 * via the Open-Meteo API (free, no API key required).
 * Creates a single device with 14 data points.
 */

// ============================================================
// Local type definitions (no imports from Sowel source)
// ============================================================

interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
}

interface EventBus {
  emit(event: unknown): void;
}

interface SettingsManager {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface DiscoveredDevice {
  ieeeAddress?: string;
  friendlyName: string;
  manufacturer?: string;
  model?: string;
  data: {
    key: string;
    type: string;
    category: string;
    unit?: string;
  }[];
  orders: {
    key: string;
    type: string;
    dispatchConfig: Record<string, unknown>;
    min?: number;
    max?: number;
    enumValues?: string[];
    unit?: string;
  }[];
}

interface DeviceManager {
  upsertFromDiscovery(
    integrationId: string,
    source: string,
    discovered: DiscoveredDevice,
  ): void;
  updateDeviceData(
    integrationId: string,
    sourceDeviceId: string,
    payload: Record<string, unknown>,
  ): void;
}

interface Device {
  id: string;
  integrationId: string;
  sourceDeviceId: string;
  name: string;
  manufacturer?: string;
  model?: string;
}

interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

interface IntegrationSettingDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}

// ============================================================
// Open-Meteo API types
// ============================================================

interface OpenMeteoResponse {
  daily: {
    weather_code: number[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    precipitation_probability_max: number[];
    wind_gusts_10m_max: number[];
  };
}

// ============================================================
// Weather condition type
// ============================================================

type WeatherCondition =
  | "sunny"
  | "partly_cloudy"
  | "cloudy"
  | "foggy"
  | "rainy"
  | "snowy"
  | "stormy";

// ============================================================
// Constants
// ============================================================

const PLUGIN_ID = "weather-forecast";
const SETTINGS_PREFIX = `integration.${PLUGIN_ID}.`;
const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 30_000;
const SOURCE_DEVICE_ID = "Weather Forecast"; // Must match friendlyName for updateDeviceData lookup
const MIN_POLL_INTERVAL_MIN = 15;
const DEFAULT_POLL_INTERVAL_MIN = 30;

// ============================================================
// WMO weather code mapping
// ============================================================

function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return "sunny";
  if (code === 1 || code === 2) return "partly_cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snowy";
  if (code >= 95 && code <= 99) return "stormy";
  // Fallback for unknown codes
  return "cloudy";
}

// ============================================================
// Discovered device definition (static)
// ============================================================

const FORECAST_DAYS = 5;

function buildForecastDataDefs(): DiscoveredDevice["data"] {
  const data: DiscoveredDevice["data"] = [];
  for (let i = 1; i <= FORECAST_DAYS; i++) {
    data.push(
      { key: `j${i}_condition`, type: "enum", category: "weather_condition" },
      { key: `j${i}_temp_min`, type: "number", category: "temperature", unit: "°C" },
      { key: `j${i}_temp_max`, type: "number", category: "temperature", unit: "°C" },
      { key: `j${i}_rain_prob`, type: "number", category: "rain", unit: "%" },
      { key: `j${i}_wind_gusts`, type: "number", category: "wind", unit: "km/h" },
    );
  }
  return data;
}

const WEATHER_DISCOVERED_DEVICE: DiscoveredDevice = {
  friendlyName: "Weather Forecast",
  manufacturer: "Open-Meteo",
  model: "Forecast API",
  data: buildForecastDataDefs(),
  orders: [],
};

// ============================================================
// Plugin implementation
// ============================================================

class WeatherForecastPlugin implements IntegrationPlugin {
  readonly id = PLUGIN_ID;
  readonly name = "Weather Forecast";
  readonly description = "Weather forecast via Open-Meteo API";
  readonly icon = "CloudSun";

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;

  // Polling state
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPollAt: string | null = null;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MIN * 60 * 1000;

  // Connection state
  private status: IntegrationStatus = "disconnected";
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  constructor(deps: PluginDeps) {
    this.logger = deps.logger.child({ module: PLUGIN_ID });
    this.eventBus = deps.eventBus;
    this.settingsManager = deps.settingsManager;
    this.deviceManager = deps.deviceManager;
  }

  // ============================================================
  // IntegrationPlugin interface
  // ============================================================

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return (
      !!this.settingsManager.get("home.latitude") &&
      !!this.settingsManager.get("home.longitude")
    );
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "polling_interval",
        label: "Polling interval (minutes)",
        type: "number",
        required: false,
        defaultValue: "30",
        placeholder: "Min 15, default 30",
      },
    ];
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return { lastPollAt: this.lastPollAt ?? "", intervalMs: this.pollIntervalMs };
  }

  async start(options?: { pollOffset?: number }): Promise<void> {
    // Clean up previous state
    this.stopTimers();

    if (!this.isConfigured()) {
      this.status = "not_configured";
      this.logger.warn("Home latitude/longitude not configured — plugin cannot start");
      return;
    }

    // Read polling interval from settings
    const rawInterval = parseInt(
      this.settingsManager.get(`${SETTINGS_PREFIX}polling_interval`) ?? String(DEFAULT_POLL_INTERVAL_MIN),
      10,
    );
    const pollingIntervalMin = Math.max(
      MIN_POLL_INTERVAL_MIN,
      isNaN(rawInterval) ? DEFAULT_POLL_INTERVAL_MIN : rawInterval,
    );
    this.pollIntervalMs = pollingIntervalMin * 60 * 1000;

    try {
      // Initial poll
      await this.poll();

      // Schedule periodic polling
      const offset = options?.pollOffset ?? 0;
      this.schedulePoll(offset);

      this.status = "connected";
      this.retryCount = 0;
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info(
        { pollIntervalMs: this.pollIntervalMs },
        "Weather Forecast integration started",
      );
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Weather Forecast integration");
      this.scheduleRetry();
    }
  }

  async stop(): Promise<void> {
    this.cancelRetry();
    this.stopTimers();
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info("Weather Forecast integration stopped");
  }

  async executeOrder(
    _device: Device,
    _dispatchConfig: Record<string, unknown>,
    _value: unknown,
  ): Promise<void> {
    throw new Error("Weather Forecast plugin does not support orders");
  }

  async refresh(): Promise<void> {
    await this.poll();
    this.logger.info("Weather Forecast manual refresh completed");
  }

  // ============================================================
  // Polling
  // ============================================================

  private async poll(): Promise<void> {
    const lat = this.settingsManager.get("home.latitude");
    const lon = this.settingsManager.get("home.longitude");

    if (!lat || !lon) {
      throw new Error("Home latitude/longitude not available");
    }

    try {
      const data = await this.fetchForecast(lat, lon);

      // Upsert device definition
      this.deviceManager.upsertFromDiscovery(PLUGIN_ID, SOURCE_DEVICE_ID, WEATHER_DISCOVERED_DEVICE);

      // Build payload — J+1 to J+5 (daily index 1..5, index 0 = today)
      const payload: Record<string, unknown> = {};
      for (let i = 1; i <= FORECAST_DAYS; i++) {
        payload[`j${i}_condition`] = mapWeatherCode(data.daily.weather_code[i]);
        payload[`j${i}_temp_min`] = data.daily.temperature_2m_min[i];
        payload[`j${i}_temp_max`] = data.daily.temperature_2m_max[i];
        payload[`j${i}_rain_prob`] = data.daily.precipitation_probability_max[i];
        payload[`j${i}_wind_gusts`] = data.daily.wind_gusts_10m_max[i];
      }

      // Update device data
      this.deviceManager.updateDeviceData(PLUGIN_ID, SOURCE_DEVICE_ID, payload);

      this.lastPollAt = new Date().toISOString();
      this.logger.info(
        {
          j1: mapWeatherCode(data.daily.weather_code[1]),
          j1_temp: `${data.daily.temperature_2m_min[1]}/${data.daily.temperature_2m_max[1]}°C`,
          j1_rain: `${data.daily.precipitation_probability_max[1]}%`,
        },
        "Weather Forecast poll complete",
      );
    } catch (err) {
      this.logger.error({ err }, "Weather Forecast poll failed");
      throw err;
    }
  }

  // ============================================================
  // Open-Meteo API
  // ============================================================

  private async fetchForecast(lat: string, lon: string): Promise<OpenMeteoResponse> {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_gusts_10m_max",
      timezone: "auto",
      forecast_days: String(FORECAST_DAYS + 1), // +1 because index 0 = today, we want J+1 to J+5
    });

    const url = `${OPEN_METEO_BASE_URL}?${params.toString()}`;
    const res = await this.fetchWithTimeout(url, { method: "GET" });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Open-Meteo API request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as OpenMeteoResponse;

    // Validate response structure
    if (!data.daily) {
      throw new Error("Invalid Open-Meteo API response: missing daily data");
    }

    return data;
  }

  // ============================================================
  // Scheduling
  // ============================================================

  private schedulePoll(offsetMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);

    const delay = offsetMs > 0 ? offsetMs : this.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (_err) {
        // Error already logged in poll()
      }
      // Schedule next poll regardless of success/failure
      this.schedulePoll(0);
    }, delay);
  }

  // ============================================================
  // Retry logic
  // ============================================================

  private scheduleRetry(): void {
    this.cancelRetry();
    this.retryCount++;
    const delaySec = Math.min(30 * Math.pow(2, this.retryCount - 1), 600);
    this.logger.warn({ retryCount: this.retryCount, delaySec }, "Scheduling automatic retry");
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.start().catch((err) => this.logger.error({ err }, "Retry start failed"));
    }, delaySec * 1000);
  }

  private cancelRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private stopTimers(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ============================================================
// Plugin factory (exported for Sowel plugin loader)
// ============================================================

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new WeatherForecastPlugin(deps);
}
