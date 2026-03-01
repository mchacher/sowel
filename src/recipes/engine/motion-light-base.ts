import type { RecipeSlotDef } from "../../shared/types.js";
import { ROOT_ZONE_ID } from "../../shared/constants.js";
import { Recipe, type RecipeContext } from "./recipe.js";
import { parseDuration, formatDuration } from "./duration.js";
import { isAnyLightOn, turnOnLights, turnOffLights } from "./light-helpers.js";

// ============================================================
// MotionLightBase — abstract base class for motion-light recipes
// ============================================================

/** Hysteresis factor to prevent lux-based on/off oscillation.
 *  Turn-on: lux <= threshold.  Turn-off: lux > threshold × (1 + factor). */
export const LUX_HYSTERESIS_FACTOR = 0.1;

/**
 * Common slot definitions shared by both simple and dimmable variants.
 * Subclasses append their own specific slots.
 */
export function baseSlots(): RecipeSlotDef[] {
  return [
    {
      id: "zone",
      name: "Zone",
      description: "Zone to monitor",
      type: "zone",
      required: true,
    },
    // "lights" slot is defined by each subclass (different equipmentType constraints)
  ];
}

/**
 * Common trailing slots (after the subclass-specific "lights" slot).
 */
export function commonTrailingSlots(): RecipeSlotDef[] {
  return [
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
      description:
        "Lights won't turn on when ambient brightness exceeds this value; turns off if it rises above threshold + 10% hysteresis",
      type: "number",
      required: false,
      constraints: { min: 0 },
    },
    {
      id: "maxOnDuration",
      name: "Safety Auto-off",
      description: "Force lights off after this duration even with continued motion (failsafe)",
      type: "duration",
      required: false,
    },
    {
      id: "buttons",
      name: "Manual Switches",
      description: "Physical switches for manual on/off toggle",
      type: "equipment",
      required: false,
      list: true,
      constraints: { equipmentType: "button" },
    },
    {
      id: "disableWhenDaylight",
      name: "Inactive During Day",
      description:
        "Do not turn on lights during daytime (based on sunrise/sunset and offsets from settings)",
      type: "boolean",
      required: false,
    },
  ];
}

export abstract class MotionLightBase extends Recipe {
  // Subclasses define: id, name, description, slots, i18n

  // -- Common state --
  protected offTimer: ReturnType<typeof setTimeout> | null = null;
  protected failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  protected unsubs: (() => void)[] = [];
  protected ctx!: RecipeContext;
  protected zoneId!: string;
  protected lightIds!: string[];
  protected timeoutMs!: number;
  protected luxThreshold: number | null = null;
  protected maxOnDurationMs: number | null = null;
  protected buttonIds: string[] = [];
  protected overrideMode = false;
  protected lightsOnByRecipe = false;
  protected disableWhenDaylight = false;
  /** Grace period: ignore light-off echoes for 5s after the recipe itself sends a turnOff */
  protected turnOffGraceUntil = 0;

  // ============================================================
  // Template methods — override in subclasses
  // ============================================================

  /** Perform the actual turn-on action (simple: ON, dimmable: ON + brightness). */
  protected doTurnOn(): void {
    const errors = turnOnLights(this.lightIds, this.ctx);
    if (errors.length > 0) {
      this.ctx.log(`Error turning on some lights: ${errors.join("; ")}`, "error");
    }
    this.ctx.log(`Motion detected — ${this.lightIds.length} light(s) turned on`);
  }

  /** Extra validation for subclass-specific params. */
  protected validateExtra(_params: Record<string, unknown>, _ctx: RecipeContext): void {}

  /** Extra initialization for subclass-specific params. */
  protected startExtra(_params: Record<string, unknown>, _ctx: RecipeContext): void {}

  /** Extra cleanup for subclass-specific state. */
  protected stopExtra(): void {}

  // ============================================================
  // Validation
  // ============================================================

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
    const lightsSlot = this.slots.find((s) => s.id === "lights");
    const allowedTypes = lightsSlot?.constraints?.equipmentType
      ? Array.isArray(lightsSlot.constraints.equipmentType)
        ? lightsSlot.constraints.equipmentType
        : [lightsSlot.constraints.equipmentType]
      : null;
    for (const lightId of lightIds) {
      const equipment = ctx.equipmentManager.getByIdWithDetails(lightId);
      if (!equipment) {
        throw new Error(`Light equipment not found: ${lightId}`);
      }
      if (allowedTypes && !allowedTypes.includes(equipment.type)) {
        throw new Error(
          `Light "${equipment.name}" is type "${equipment.type}" but this recipe requires ${allowedTypes.join(" or ")}`,
        );
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

    // Validate buttons (optional)
    const { buttons } = params;
    if (buttons !== undefined && buttons !== null) {
      const buttonIds = Array.isArray(buttons)
        ? buttons.filter((id): id is string => typeof id === "string")
        : [];
      for (const buttonId of buttonIds) {
        const equipment = ctx.equipmentManager.getByIdWithDetails(buttonId);
        if (!equipment) {
          throw new Error(`Button equipment not found: ${buttonId}`);
        }
        const hasActionData = equipment.dataBindings.some((db) => db.alias === "action");
        if (!hasActionData) {
          throw new Error(`Button "${equipment.name}" has no "action" data binding`);
        }
      }
    }

    // Subclass-specific validation
    this.validateExtra(params, ctx);
  }

  // ============================================================
  // Start
  // ============================================================

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

    // Button support
    this.buttonIds = Array.isArray(params.buttons)
      ? params.buttons.filter((id): id is string => typeof id === "string")
      : [];

    // Daylight option
    this.disableWhenDaylight = params.disableWhenDaylight === true;

    // Reset override (clear any stale state from previous run)
    this.overrideMode = false;
    this.lightsOnByRecipe = isAnyLightOn(this.lightIds, ctx);
    ctx.state.delete("overrideMode");
    ctx.notifyStateChanged();

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

    // Listen to button actions (optional)
    if (this.buttonIds.length > 0) {
      const unsubButton = ctx.eventBus.onType("equipment.data.changed", (event) => {
        if (!this.buttonIds.includes(event.equipmentId)) return;
        if (event.alias !== "action") return;
        this.onButtonAction();
      });
      this.unsubs.push(unsubButton);
    }

    // Subclass-specific initialization
    this.startExtra(params, ctx);

    // Force consistent light state on activation
    this.syncLightsOnStart();
    // Reset grace — syncLightsOnStart's turnOff is not a "recipe action" that
    // should suppress manual-off override detection
    this.turnOffGraceUntil = 0;
  }

  // ============================================================
  // Stop
  // ============================================================

  stop(): void {
    this.cancelOffTimer();
    this.cancelFailsafeTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.overrideMode = false;
    this.lightsOnByRecipe = false;
    this.turnOffGraceUntil = 0;
    this.ctx.state.delete("overrideMode");
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.state.delete("failsafeExpiresAt");
    this.stopExtra();
    this.ctx.notifyStateChanged();
  }

  // ============================================================
  // Param normalization (backward compat)
  // ============================================================

  protected normalizeLights(params: Record<string, unknown>): string[] {
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
  // Initial sync
  // ============================================================

  private syncLightsOnStart(): void {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    const motion = zoneData?.motion ?? false;
    const luminosity = zoneData?.luminosity ?? null;

    if (motion && !this.isTooBright(luminosity) && !this.isDaytime()) {
      this.turnOn();
    } else {
      const reason = this.isDaytime()
        ? "Recipe activated — daytime, lights off"
        : motion
          ? "Recipe activated — luminosity above threshold, lights off"
          : "Recipe activated — no motion, lights off";
      this.turnOff(reason);
    }
  }

  // ============================================================
  // Daylight check
  // ============================================================

  protected isDaytime(): boolean {
    if (!this.disableWhenDaylight) return false;
    const rootData = this.ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID);
    // null isDaylight (no coordinates configured) → treated as night → recipe functions normally
    return rootData?.isDaylight === true;
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onZoneChanged(motion: boolean, luminosity: number | null): void {
    // Override mode: recipe is suspended, only track room vacancy
    if (this.overrideMode) {
      if (motion) {
        this.cancelOffTimer();
        this.clearOffTimerState();
        this.resetFailsafeTimer();
        this.ctx.log("Motion detected but override mode active — ignoring");
      } else {
        this.startOffTimerForOverrideClear();
      }
      return;
    }

    // Normal (auto) mode
    const lightsOn = isAnyLightOn(this.lightIds, this.ctx);

    // Dynamic lux check: turn off if luminosity rose above threshold (with hysteresis)
    if (lightsOn && this.isBrightEnoughToTurnOff(luminosity)) {
      if (!this.lightsOnByRecipe) {
        // Grace period: recipe recently sent OFF — this ON echo is a stale
        // MQTT round-trip from a previous turnOn, not a manual action.
        if (Date.now() < this.turnOffGraceUntil) return;
        this.overrideMode = true;
        this.ctx.state.set("overrideMode", true);
        this.ctx.notifyStateChanged();
        this.startFailsafeTimer();
        this.ctx.log("Light turned on manually above lux threshold — entering override mode");
        return;
      }
      this.cancelOffTimer();
      this.clearOffTimerState();
      this.turnOff("Luminosity above threshold — lights turned off");
      return;
    }

    if (motion && !lightsOn) {
      // If recipe had turned lights on but they're now off → manual turn-off
      if (this.lightsOnByRecipe) {
        this.lightsOnByRecipe = false;
        // Grace period: recipe's own turnoff echo → ignore
        if (Date.now() < this.turnOffGraceUntil) {
          return;
        }
        // Manual turnoff while motion active → override
        this.overrideMode = true;
        this.ctx.state.set("overrideMode", true);
        this.ctx.notifyStateChanged();
        this.startOffTimerForOverrideClear();
        this.ctx.log("Light turned off manually while motion active — entering override mode");
        return;
      }
      // Check lux threshold before turning on
      if (this.isTooBright(luminosity)) {
        this.ctx.log(
          `Motion detected but luminosity ${luminosity} exceeds threshold ${this.luxThreshold} — not turning on`,
        );
        return;
      }
      // Check daylight before turning on
      if (this.isDaytime()) {
        this.ctx.log("Motion detected but daytime — not turning on");
        return;
      }
      this.turnOn();
    } else if (motion && lightsOn) {
      // Reset off-timer and failsafe on every motion impulse
      this.cancelOffTimer();
      this.clearOffTimerState();
      this.resetFailsafeTimer();
    } else if (!motion && lightsOn) {
      this.startOffTimer();
    }
    // !motion && !lightsOn → nothing to do
  }

  protected onLightChanged(value: unknown): void {
    if (this.overrideMode) return;

    const lightOn = value === true || String(value).toUpperCase() === "ON";
    const motion = this.hasMotion();

    if (lightOn && !motion) {
      this.startOffTimer();
      this.startFailsafeTimer();
      this.ctx.log(`Light turned on externally — turning off in ${formatDuration(this.timeoutMs)}`);
    } else if (lightOn && motion) {
      this.cancelOffTimer();
      this.clearOffTimerState();
    } else if (!lightOn) {
      this.lightsOnByRecipe = false;
      if (this.offTimer || this.failsafeTimer) {
        this.cancelOffTimer();
        this.cancelFailsafeTimer();
        this.clearOffTimerState();
        this.clearFailsafeTimerState();
        this.ctx.log("Light turned off externally — timers cancelled");
      }
      // Note: manual-off override detection is handled in onZoneChanged
      // (which fires first) using the lightsOnByRecipe flag.
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

  private isBrightEnoughToTurnOff(luminosity: number | null): boolean {
    if (this.luxThreshold === null) return false;
    if (luminosity === null) return false;
    return luminosity > this.luxThreshold * (1 + LUX_HYSTERESIS_FACTOR);
  }

  // ============================================================
  // Motion state helper
  // ============================================================

  protected hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ============================================================
  // Actions
  // ============================================================

  protected turnOn(): void {
    this.lightsOnByRecipe = true;
    this.doTurnOn();
    this.startFailsafeTimer();
  }

  protected turnOff(reason: string): void {
    this.lightsOnByRecipe = false;
    this.turnOffGraceUntil = Date.now() + 5000;
    const errors = turnOffLights(this.lightIds, this.ctx);
    if (errors.length > 0) {
      this.ctx.log(`Error turning off some lights: ${errors.join("; ")}`, "error");
    }
    this.ctx.log(reason);
    this.cancelFailsafeTimer();
    this.clearFailsafeTimerState();
    this.clearOverrideMode();
  }

  // ============================================================
  // Button handler
  // ============================================================

  private onButtonAction(): void {
    if (isAnyLightOn(this.lightIds, this.ctx)) {
      this.lightsOnByRecipe = false;
      this.turnOffGraceUntil = Date.now() + 5000;
      const errors = turnOffLights(this.lightIds, this.ctx);
      if (errors.length > 0) {
        this.ctx.log(`Error turning off some lights: ${errors.join("; ")}`, "error");
      }
      this.cancelOffTimer();
      this.clearOffTimerState();
      this.cancelFailsafeTimer();
      this.clearFailsafeTimerState();

      this.overrideMode = true;
      this.ctx.state.set("overrideMode", true);
      this.ctx.notifyStateChanged();
      this.ctx.log("Button pressed — lights off, entering override mode");

      this.startOffTimerForOverrideClear();
    } else {
      this.clearOverrideMode();
      this.turnOn();
    }
  }

  // ============================================================
  // Override management
  // ============================================================

  protected clearOverrideMode(): void {
    if (!this.overrideMode) return;
    this.overrideMode = false;
    this.ctx.state.delete("overrideMode");
    this.ctx.notifyStateChanged();
  }

  private startOffTimerForOverrideClear(): void {
    this.cancelOffTimer();
    this.offTimer = setTimeout(() => {
      this.offTimer = null;
      this.clearOffTimerState();
      if (isAnyLightOn(this.lightIds, this.ctx)) {
        this.lightsOnByRecipe = false;
        this.turnOffGraceUntil = Date.now() + 5000;
        turnOffLights(this.lightIds, this.ctx);
      }
      this.clearOverrideMode();
      this.cancelFailsafeTimer();
      this.clearFailsafeTimerState();
      this.ctx.log(
        `No motion for ${formatDuration(this.timeoutMs)} — override cleared, lights off`,
      );
    }, this.timeoutMs);
    this.persistOffTimerState();
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

  private resetFailsafeTimer(): void {
    if (this.maxOnDurationMs === null) return;
    if (!this.failsafeTimer) return;
    this.cancelFailsafeTimer();
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
    this.lightsOnByRecipe = false;
    this.turnOffGraceUntil = Date.now() + 5000;
    const errors = turnOffLights(this.lightIds, this.ctx);
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
