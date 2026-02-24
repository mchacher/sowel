import type { RecipeSlotDef } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";

// ============================================================
// Duration parsing helper
// ============================================================

function parseDuration(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error(`Invalid duration: ${value}`);

  const match = value.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration format: ${value}. Use e.g. "10m", "30s", "1h"`);

  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  if (ms >= 60 * 1000) return `${Math.round(ms / (60 * 1000))}min`;
  return `${Math.round(ms / 1000)}s`;
}

// ============================================================
// Motion-Light Recipe
// ============================================================

export class MotionLightRecipe extends Recipe {
  readonly id = "motion-light";
  readonly name = "Motion Light";
  readonly description =
    "Turns on lights when motion is detected, turns off after a timeout with no motion. Supports multiple lights, optional lux threshold, and failsafe max-on duration.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone to monitor",
      type: "zone",
      required: true,
    },
    {
      id: "lights",
      name: "Lights",
      description: "Lights to control (must belong to the selected zone)",
      type: "equipment",
      required: true,
      list: true,
      constraints: { equipmentType: ["light_onoff", "light_dimmable", "light_color"] },
    },
    {
      id: "timeout",
      name: "Timeout",
      description: "Delay with no motion before turning off",
      type: "duration",
      required: true,
      defaultValue: "10m",
    },
    {
      id: "luxThreshold",
      name: "Lux Threshold",
      description: "Do not turn on if zone luminosity is above this value (optional)",
      type: "number",
      required: false,
      constraints: { min: 0 },
    },
    {
      id: "maxOnDuration",
      name: "Max On Duration",
      description: "Force lights off after this duration, regardless of motion (optional failsafe)",
      type: "duration",
      required: false,
    },
  ];

  private offTimer: ReturnType<typeof setTimeout> | null = null;
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private ctx!: RecipeContext;
  private zoneId!: string;
  private lightIds!: string[];
  private timeoutMs!: number;
  private luxThreshold: number | null = null;
  private maxOnDurationMs: number | null = null;

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, timeout, luxThreshold, maxOnDuration } = params;

    // Normalize lights (backward compat: single light → lights array)
    const lightIds = this.normalizeLights(params);

    // Validate zone exists
    if (!zone || typeof zone !== "string") {
      throw new Error("Zone parameter is required");
    }
    const zoneObj = ctx.zoneManager.getById(zone);
    if (!zoneObj) {
      throw new Error(`Zone not found: ${zone}`);
    }
    const zoneData = ctx.zoneAggregator.getByZoneId(zone);
    if (zoneData && zoneData.motionSensors === 0) {
      ctx.log(`Zone has no motion sensors — recipe will never trigger`, "warn");
    }

    // Validate lights
    if (lightIds.length === 0) {
      throw new Error("At least one light is required");
    }
    for (const lightId of lightIds) {
      const equipment = ctx.equipmentManager.getByIdWithDetails(lightId);
      if (!equipment) {
        throw new Error(`Light equipment not found: ${lightId}`);
      }
      if (equipment.zoneId !== zone) {
        throw new Error(`Light "${equipment.name}" does not belong to the selected zone`);
      }
      const hasStateOrder = equipment.orderBindings.some((ob) => ob.alias === "state");
      if (!hasStateOrder) {
        throw new Error(`Light "${equipment.name}" has no "state" order binding`);
      }
    }

    // Validate timeout
    const timeoutValue = timeout ?? "10m";
    parseDuration(timeoutValue);

    // Validate luxThreshold
    if (luxThreshold !== undefined && luxThreshold !== null) {
      const lux = Number(luxThreshold);
      if (isNaN(lux) || lux < 0) {
        throw new Error("luxThreshold must be a non-negative number");
      }
    }

    // Validate maxOnDuration
    if (maxOnDuration !== undefined && maxOnDuration !== null) {
      parseDuration(maxOnDuration);
    }
  }

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.ctx = ctx;
    this.zoneId = params.zone as string;
    this.lightIds = this.normalizeLights(params);
    this.timeoutMs = parseDuration(params.timeout ?? "10m");
    this.luxThreshold =
      params.luxThreshold !== undefined && params.luxThreshold !== null
        ? Number(params.luxThreshold)
        : null;
    this.maxOnDurationMs =
      params.maxOnDuration !== undefined && params.maxOnDuration !== null
        ? parseDuration(params.maxOnDuration)
        : null;

    // Listen to zone aggregation changes (for motion + luminosity)
    const unsubZone = ctx.eventBus.onType("zone.data.changed", (event) => {
      if (event.zoneId !== this.zoneId) return;
      this.onZoneChanged(event.aggregatedData.motion, event.aggregatedData.luminosity);
    });
    this.unsubs.push(unsubZone);

    // Listen to light state changes (for manual on/off)
    const unsubLight = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (!this.lightIds.includes(event.equipmentId)) return;
      if (event.alias !== "state") return;
      this.onLightChanged(event.value);
    });
    this.unsubs.push(unsubLight);
  }

  stop(): void {
    this.cancelOffTimer();
    this.cancelFailsafeTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }

  // ============================================================
  // Param normalization (backward compat)
  // ============================================================

  private normalizeLights(params: Record<string, unknown>): string[] {
    if (Array.isArray(params.lights)) {
      return params.lights.filter((id): id is string => typeof id === "string");
    }
    // Backward compat: single "light" param
    if (typeof params.light === "string") {
      return [params.light];
    }
    return [];
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onZoneChanged(motion: boolean, luminosity: number | null): void {
    const lightsOn = this.isAnyLightOn();

    if (motion && !lightsOn) {
      // Check lux threshold before turning on
      if (this.isTooBright(luminosity)) {
        return;
      }
      this.turnOn();
    } else if (motion && lightsOn) {
      // Reset off-timer on every motion impulse
      this.cancelOffTimer();
      this.clearOffTimerState();
    } else if (!motion && lightsOn) {
      this.startOffTimer();
    }
    // !motion && !lightsOn → nothing to do
  }

  private onLightChanged(value: unknown): void {
    const lightOn = value === true || value === "ON";
    const motion = this.hasMotion();

    if (lightOn && !motion) {
      this.startOffTimer();
      this.startFailsafeTimer();
      this.ctx.log(`Light turned on externally — turning off in ${formatDuration(this.timeoutMs)}`);
    } else if (lightOn && motion) {
      this.cancelOffTimer();
      this.clearOffTimerState();
    } else if (!lightOn) {
      this.cancelOffTimer();
      this.cancelFailsafeTimer();
      this.clearOffTimerState();
      this.clearFailsafeTimerState();
      this.ctx.log("Light turned off externally — timers cancelled");
    }
  }

  // ============================================================
  // Lux threshold check
  // ============================================================

  private isTooBright(luminosity: number | null): boolean {
    if (this.luxThreshold === null) return false;
    if (luminosity === null) return false;
    return luminosity > this.luxThreshold;
  }

  // ============================================================
  // Light state helpers
  // ============================================================

  private isAnyLightOn(): boolean {
    for (const lightId of this.lightIds) {
      const bindings = this.ctx.equipmentManager.getDataBindingsWithValues(lightId);
      const stateBinding = bindings.find(
        (b) => b.alias === "state" || b.category === "light_state",
      );
      if (stateBinding && (stateBinding.value === true || stateBinding.value === "ON")) {
        return true;
      }
    }
    return false;
  }

  private hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ============================================================
  // Actions
  // ============================================================

  private turnOn(): void {
    const errors: string[] = [];
    for (const lightId of this.lightIds) {
      try {
        this.ctx.equipmentManager.executeOrder(lightId, "state", "ON");
      } catch (err) {
        errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      this.ctx.log(`Error turning on some lights: ${errors.join("; ")}`, "error");
    }
    this.ctx.log(`Motion detected — ${this.lightIds.length} light(s) turned on`);
    this.startFailsafeTimer();
  }

  private turnOff(reason: string): void {
    const errors: string[] = [];
    for (const lightId of this.lightIds) {
      try {
        this.ctx.equipmentManager.executeOrder(lightId, "state", "OFF");
      } catch (err) {
        errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      this.ctx.log(`Error turning off some lights: ${errors.join("; ")}`, "error");
    }
    this.ctx.log(reason);
    this.cancelFailsafeTimer();
    this.clearFailsafeTimerState();
  }

  // ============================================================
  // Off-timer management
  // ============================================================

  private startOffTimer(): void {
    this.cancelOffTimer();
    this.offTimer = setTimeout(() => {
      this.offTimer = null;
      this.clearOffTimerState();
      this.turnOff(`No motion for ${formatDuration(this.timeoutMs)} — lights turned off`);
    }, this.timeoutMs);
    this.persistOffTimerState();
  }

  private cancelOffTimer(): void {
    if (this.offTimer) {
      clearTimeout(this.offTimer);
      this.offTimer = null;
    }
  }

  private persistOffTimerState(): void {
    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString();
    this.ctx.state.set("timerExpiresAt", expiresAt);
    this.ctx.notifyStateChanged();
  }

  private clearOffTimerState(): void {
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.notifyStateChanged();
  }

  // ============================================================
  // Failsafe timer management
  // ============================================================

  private startFailsafeTimer(): void {
    if (this.maxOnDurationMs === null) return;
    // Don't restart if already running
    if (this.failsafeTimer) return;

    this.failsafeTimer = setTimeout(() => {
      this.failsafeTimer = null;
      this.clearFailsafeTimerState();
      this.cancelOffTimer();
      this.clearOffTimerState();
      this.turnOffFailsafe();
    }, this.maxOnDurationMs);
    this.persistFailsafeTimerState();
  }

  private cancelFailsafeTimer(): void {
    if (this.failsafeTimer) {
      clearTimeout(this.failsafeTimer);
      this.failsafeTimer = null;
    }
  }

  private turnOffFailsafe(): void {
    const errors: string[] = [];
    for (const lightId of this.lightIds) {
      try {
        this.ctx.equipmentManager.executeOrder(lightId, "state", "OFF");
      } catch (err) {
        errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      this.ctx.log(`Error turning off some lights: ${errors.join("; ")}`, "error");
    }
    this.ctx.log(
      `Failsafe: lights forced off after ${formatDuration(this.maxOnDurationMs!)} max on duration`,
      "warn",
    );
  }

  private persistFailsafeTimerState(): void {
    const expiresAt = new Date(Date.now() + this.maxOnDurationMs!).toISOString();
    this.ctx.state.set("failsafeExpiresAt", expiresAt);
    this.ctx.notifyStateChanged();
  }

  private clearFailsafeTimerState(): void {
    this.ctx.state.delete("failsafeExpiresAt");
    this.ctx.notifyStateChanged();
  }
}
