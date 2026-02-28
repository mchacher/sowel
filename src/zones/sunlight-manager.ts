import SunCalc from "suncalc";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";

export interface SunlightData {
  sunrise: string | null;
  sunset: string | null;
  isDaylight: boolean | null;
}

export class SunlightManager {
  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;

  private currentData: SunlightData = { sunrise: null, sunset: null, isDaylight: null };
  private lastComputedDate: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(settingsManager: SettingsManager, eventBus: EventBus, logger: Logger) {
    this.settingsManager = settingsManager;
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "sunlight-manager" });
  }

  start(): void {
    this.compute();

    // Check isDaylight every 60 seconds and detect date changes
    this.intervalId = setInterval(() => {
      this.tick();
    }, 60_000);

    // React to settings changes
    this.unsubscribe = this.eventBus.onType("settings.changed", (event) => {
      const relevant = event.keys.some((k) => k.startsWith("home."));
      if (relevant) {
        this.logger.info("Home settings changed, recomputing sunlight");
        this.compute();
      }
    });

    this.logger.info(
      {
        sunrise: this.currentData.sunrise,
        sunset: this.currentData.sunset,
        isDaylight: this.currentData.isDaylight,
      },
      "Sunlight manager started",
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getSunlightData(): SunlightData {
    return this.currentData;
  }

  private getSettings(): {
    latitude: number;
    longitude: number;
    sunriseOffset: number;
    sunsetOffset: number;
  } | null {
    const lat = this.settingsManager.get("home.latitude");
    const lon = this.settingsManager.get("home.longitude");
    if (!lat || !lon) return null;

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (isNaN(latitude) || isNaN(longitude)) return null;

    const sunriseOffsetRaw = this.settingsManager.get("home.sunriseOffset");
    const sunsetOffsetRaw = this.settingsManager.get("home.sunsetOffset");
    const sunriseOffset = sunriseOffsetRaw ? parseInt(sunriseOffsetRaw, 10) : 30;
    const sunsetOffset = sunsetOffsetRaw ? parseInt(sunsetOffsetRaw, 10) : 45;

    return {
      latitude,
      longitude,
      sunriseOffset: isNaN(sunriseOffset) ? 30 : sunriseOffset,
      sunsetOffset: isNaN(sunsetOffset) ? 45 : sunsetOffset,
    };
  }

  private compute(): void {
    const settings = this.getSettings();
    if (!settings) {
      const changed =
        this.currentData.sunrise !== null ||
        this.currentData.sunset !== null ||
        this.currentData.isDaylight !== null;
      this.currentData = { sunrise: null, sunset: null, isDaylight: null };
      this.lastComputedDate = null;
      if (changed) {
        this.eventBus.emit({ type: "sunlight.changed" });
      }
      return;
    }

    const now = new Date();
    const times = SunCalc.getTimes(now, settings.latitude, settings.longitude);

    const sunrise = this.formatTime(times.sunrise);
    const sunset = this.formatTime(times.sunset);

    // isDaylight: true when now > sunrise + sunriseOffset AND now < sunset - sunsetOffset
    const sunriseWithOffset = new Date(times.sunrise.getTime() + settings.sunriseOffset * 60_000);
    const sunsetWithOffset = new Date(times.sunset.getTime() - settings.sunsetOffset * 60_000);
    const isDaylight = now >= sunriseWithOffset && now < sunsetWithOffset;

    const prev = this.currentData;
    this.currentData = { sunrise, sunset, isDaylight };
    this.lastComputedDate = this.dateKey(now);

    if (prev.sunrise !== sunrise || prev.sunset !== sunset || prev.isDaylight !== isDaylight) {
      this.eventBus.emit({ type: "sunlight.changed" });
    }
  }

  private tick(): void {
    const now = new Date();
    const todayKey = this.dateKey(now);

    // Date changed — recompute sunrise/sunset for new day
    if (this.lastComputedDate && this.lastComputedDate !== todayKey) {
      this.logger.debug("New day detected, recomputing sunrise/sunset");
      this.compute();
      return;
    }

    // Check isDaylight transition
    const settings = this.getSettings();
    if (!settings || !this.currentData.sunrise || !this.currentData.sunset) return;

    const times = SunCalc.getTimes(now, settings.latitude, settings.longitude);
    const sunriseWithOffset = new Date(times.sunrise.getTime() + settings.sunriseOffset * 60_000);
    const sunsetWithOffset = new Date(times.sunset.getTime() - settings.sunsetOffset * 60_000);
    const isDaylight = now >= sunriseWithOffset && now < sunsetWithOffset;

    if (isDaylight !== this.currentData.isDaylight) {
      this.logger.info(
        { isDaylight, previous: this.currentData.isDaylight },
        "Daylight state changed",
      );
      this.currentData = { ...this.currentData, isDaylight };
      this.eventBus.emit({ type: "sunlight.changed" });
    }
  }

  private formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
}
