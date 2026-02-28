import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";
import { parseDuration, formatDuration } from "./engine/duration.js";
import {
  isAnyLightOn,
  turnOnLights,
  turnOffLights,
  setLightsBrightness,
} from "./engine/light-helpers.js";

// ============================================================
// Motion-Light Recipe
// ============================================================

/** Hysteresis factor to prevent lux-based on/off oscillation.
 *  Turn-on: lux <= threshold.  Turn-off: lux > threshold × (1 + factor). */
const LUX_HYSTERESIS_FACTOR = 0.1;

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
      description:
        "Do not turn on if zone luminosity is above this value; turns off lights if luminosity rises above threshold + 10% hysteresis (optional)",
      type: "number",
      required: false,
      constraints: { min: 0 },
    },
    {
      id: "maxOnDuration",
      name: "Max On Duration",
      description:
        "Force lights off after this duration without motion — resets on each motion detection (optional failsafe)",
      type: "duration",
      required: false,
    },
    {
      id: "brightness",
      name: "Brightness",
      description: "Brightness level when turning on (1-254). Only applies to dimmable lights.",
      type: "number",
      required: false,
      constraints: { min: 1, max: 254 },
    },
    {
      id: "morningBrightness",
      name: "Morning Brightness",
      description: "Reduced brightness during the morning window (1-254)",
      type: "number",
      required: false,
      constraints: { min: 1, max: 254 },
    },
    {
      id: "morningStart",
      name: "Morning Start",
      description: "Start of morning window (HH:MM)",
      type: "time",
      required: false,
    },
    {
      id: "morningEnd",
      name: "Morning End",
      description: "End of morning window (HH:MM)",
      type: "time",
      required: false,
    },
    {
      id: "buttons",
      name: "Buttons",
      description: "Button/switch equipments for manual toggle (optional)",
      type: "equipment",
      required: false,
      list: true,
      constraints: { equipmentType: "button" },
    },
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Lumière sur mouvement",
      description:
        "Allume les lumières quand un mouvement est détecté, éteint après un délai sans mouvement. Supporte plusieurs lumières, un seuil de luminosité optionnel et une durée max d'allumage.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        lights: {
          name: "Lumières",
          description: "Lumières à contrôler (doivent appartenir à la zone)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant extinction" },
        luxThreshold: {
          name: "Seuil de luminosité",
          description:
            "Ne pas allumer si la luminosité dépasse ce seuil ; éteint si la luminosité dépasse le seuil + 10% d'hystérésis (optionnel)",
        },
        maxOnDuration: {
          name: "Durée max allumage",
          description:
            "Éteindre après cette durée sans mouvement — se réinitialise à chaque mouvement (sécurité)",
        },
        brightness: {
          name: "Luminosité",
          description:
            "Niveau de luminosité à l'allumage (1-254). S'applique uniquement aux lumières dimmables.",
        },
        morningBrightness: {
          name: "Luminosité matin",
          description: "Luminosité réduite pendant la plage matinale (1-254)",
        },
        morningStart: {
          name: "Début matin",
          description: "Début de la plage matinale (HH:MM)",
        },
        morningEnd: {
          name: "Fin matin",
          description: "Fin de la plage matinale (HH:MM)",
        },
        buttons: {
          name: "Boutons",
          description: "Boutons / interrupteurs pour contrôle manuel (optionnel)",
        },
      },
    },
  };

  private offTimer: ReturnType<typeof setTimeout> | null = null;
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private ctx!: RecipeContext;
  private zoneId!: string;
  private lightIds!: string[];
  private timeoutMs!: number;
  private luxThreshold: number | null = null;
  private maxOnDurationMs: number | null = null;

  // Brightness presets
  private brightness: number | null = null;
  private morningBrightness: number | null = null;
  private morningStart: string | null = null;
  private morningEnd: string | null = null;

  // Button support
  private buttonIds: string[] = [];

  // Manual override
  private overrideMode = false;
  private lastSentBrightness: number | null = null;
  private selfTriggeredLight = false;

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

    // Validate brightness
    const { brightness, morningBrightness, morningStart, morningEnd, buttons } = params;

    if (brightness !== undefined && brightness !== null && brightness !== "") {
      const b = Number(brightness);
      if (isNaN(b) || b < 1 || b > 254) {
        throw new Error("brightness must be between 1 and 254");
      }
    }

    if (morningBrightness !== undefined && morningBrightness !== null && morningBrightness !== "") {
      const mb = Number(morningBrightness);
      if (isNaN(mb) || mb < 1 || mb > 254) {
        throw new Error("morningBrightness must be between 1 and 254");
      }
    }

    // Morning window: both start and end must be provided together
    const hasStart = morningStart !== undefined && morningStart !== null && morningStart !== "";
    const hasEnd = morningEnd !== undefined && morningEnd !== null && morningEnd !== "";
    if (hasStart !== hasEnd) {
      throw new Error("morningStart and morningEnd must both be provided or both omitted");
    }
    if (hasStart && typeof morningStart === "string" && !/^\d{2}:\d{2}$/.test(morningStart)) {
      throw new Error("morningStart must be in HH:MM format");
    }
    if (hasEnd && typeof morningEnd === "string" && !/^\d{2}:\d{2}$/.test(morningEnd)) {
      throw new Error("morningEnd must be in HH:MM format");
    }

    // morningBrightness requires morning window
    if (
      morningBrightness !== undefined &&
      morningBrightness !== null &&
      morningBrightness !== "" &&
      !hasStart
    ) {
      throw new Error("morningBrightness requires morningStart and morningEnd");
    }

    // Validate buttons (optional)
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

    // Brightness presets
    this.brightness =
      params.brightness !== undefined && params.brightness !== null && params.brightness !== ""
        ? Number(params.brightness)
        : null;
    this.morningBrightness =
      params.morningBrightness !== undefined &&
      params.morningBrightness !== null &&
      params.morningBrightness !== ""
        ? Number(params.morningBrightness)
        : null;
    this.morningStart =
      typeof params.morningStart === "string" && params.morningStart ? params.morningStart : null;
    this.morningEnd =
      typeof params.morningEnd === "string" && params.morningEnd ? params.morningEnd : null;

    // Button support
    this.buttonIds = Array.isArray(params.buttons)
      ? params.buttons.filter((id): id is string => typeof id === "string")
      : [];

    // Reset override (clear any stale state from previous run)
    this.overrideMode = false;
    this.lastSentBrightness = null;
    this.selfTriggeredLight = false;
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

    // Listen to brightness changes for manual override detection
    if (this.brightness !== null) {
      const unsubBrightness = ctx.eventBus.onType("equipment.data.changed", (event) => {
        if (!this.lightIds.includes(event.equipmentId)) return;
        if (event.alias !== "brightness") return;
        this.onBrightnessChanged(event.value);
      });
      this.unsubs.push(unsubBrightness);
    }

    // Force consistent light state on activation — all ON or all OFF
    this.syncLightsOnStart();
  }

  stop(): void {
    this.cancelOffTimer();
    this.cancelFailsafeTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.overrideMode = false;
    this.lastSentBrightness = null;
    this.selfTriggeredLight = false;
    this.ctx.state.delete("overrideMode");
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.state.delete("failsafeExpiresAt");
    this.ctx.notifyStateChanged();
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
  // Initial sync — force all lights to a consistent state
  // ============================================================

  private syncLightsOnStart(): void {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    const motion = zoneData?.motion ?? false;
    const luminosity = zoneData?.luminosity ?? null;

    if (motion && !this.isTooBright(luminosity)) {
      this.turnOn();
    } else {
      this.turnOff(
        motion
          ? "Recipe activated — luminosity above threshold, lights off"
          : "Recipe activated — no motion, lights off",
      );
    }
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onZoneChanged(motion: boolean, luminosity: number | null): void {
    // Override mode: recipe is suspended, only track room vacancy
    if (this.overrideMode) {
      if (motion) {
        // Someone still in the room — cancel any pending override-clear timer
        this.cancelOffTimer();
        this.clearOffTimerState();
        this.resetFailsafeTimer();
        this.ctx.log("Motion detected but override mode active — ignoring");
      } else {
        // No motion — start timer to clear override when room empties
        this.startOffTimerForOverrideClear();
      }
      return;
    }

    // Normal (auto) mode
    const lightsOn = isAnyLightOn(this.lightIds, this.ctx);

    // Dynamic lux check: turn off if luminosity rose above threshold (with hysteresis)
    if (lightsOn && this.isBrightEnoughToTurnOff(luminosity)) {
      this.cancelOffTimer();
      this.clearOffTimerState();
      this.turnOff("Luminosity above threshold — lights turned off");
      return;
    }

    if (motion && !lightsOn) {
      // Check lux threshold before turning on
      if (this.isTooBright(luminosity)) {
        this.ctx.log(
          `Motion detected but luminosity ${luminosity} exceeds threshold ${this.luxThreshold} — not turning on`,
        );
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

  private onLightChanged(value: unknown): void {
    if (this.overrideMode) return;

    const lightOn = value === true || value === "ON";

    // If the recipe triggered this ON, just clear the flag and skip
    // (only guard ON events — OFF events must always cancel timers)
    if (lightOn && this.selfTriggeredLight) {
      this.selfTriggeredLight = false;
      return;
    }
    this.selfTriggeredLight = false;

    const motion = this.hasMotion();

    if (lightOn) {
      // Manual turn-on while lux is above threshold → the recipe would not have
      // turned on, so this is a deliberate manual override
      const luminosity = this.ctx.zoneAggregator.getByZoneId(this.zoneId)?.luminosity ?? null;
      if (this.isTooBright(luminosity)) {
        this.overrideMode = true;
        this.ctx.state.set("overrideMode", true);
        this.ctx.notifyStateChanged();
        this.startFailsafeTimer();
        this.ctx.log("Light turned on manually above lux threshold — entering override mode");
        return;
      }

      if (!motion) {
        this.startOffTimer();
        this.startFailsafeTimer();
        this.ctx.log(
          `Light turned on externally — turning off in ${formatDuration(this.timeoutMs)}`,
        );
      } else {
        this.cancelOffTimer();
        this.clearOffTimerState();
      }
    } else {
      // Only log/cancel if we had active timers (avoids noise from Zigbee periodic reports)
      if (this.offTimer || this.failsafeTimer) {
        this.cancelOffTimer();
        this.cancelFailsafeTimer();
        this.clearOffTimerState();
        this.clearFailsafeTimerState();
        this.ctx.log("Light turned off externally — timers cancelled");
      }
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

  /**
   * Check if luminosity is high enough to turn OFF lights that are already on.
   * Uses a hysteresis margin above the threshold to prevent oscillation.
   */
  private isBrightEnoughToTurnOff(luminosity: number | null): boolean {
    if (this.luxThreshold === null) return false;
    if (luminosity === null) return false;
    return luminosity > this.luxThreshold * (1 + LUX_HYSTERESIS_FACTOR);
  }

  // ============================================================
  // Motion state helper
  // ============================================================

  private hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ============================================================
  // Brightness resolution
  // ============================================================

  /**
   * Determine target brightness based on current time.
   * Returns null if no brightness is configured (plain ON/OFF behavior).
   */
  private getTargetBrightness(): number | null {
    if (this.brightness === null) return null;

    if (this.morningBrightness !== null && this.morningStart !== null && this.morningEnd !== null) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = this.morningStart.split(":").map(Number);
      const [endH, endM] = this.morningEnd.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes <= endMinutes) {
        // Same-day range (e.g., 06:00 to 09:00)
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return this.morningBrightness;
        }
      } else {
        // Overnight range (e.g., 23:00 to 06:00)
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return this.morningBrightness;
        }
      }
    }

    return this.brightness;
  }

  // ============================================================
  // Actions
  // ============================================================

  private turnOn(): void {
    this.selfTriggeredLight = true;
    const errors = turnOnLights(this.lightIds, this.ctx);
    if (errors.length > 0) {
      this.ctx.log(`Error turning on some lights: ${errors.join("; ")}`, "error");
    }

    const targetBrightness = this.getTargetBrightness();
    if (targetBrightness !== null) {
      this.lastSentBrightness = targetBrightness;
      const brightnessErrors = setLightsBrightness(this.lightIds, this.ctx, targetBrightness);
      if (brightnessErrors.length > 0) {
        this.ctx.log(`Error setting brightness: ${brightnessErrors.join("; ")}`, "error");
      }
      this.ctx.log(
        `Motion detected — ${this.lightIds.length} light(s) turned on at brightness ${targetBrightness}`,
      );
    } else {
      this.ctx.log(`Motion detected — ${this.lightIds.length} light(s) turned on`);
    }

    this.startFailsafeTimer();
  }

  private turnOff(reason: string): void {
    this.selfTriggeredLight = true;
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
      // Lights ON + button → turn OFF + enter override
      this.selfTriggeredLight = true;
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

      // Start timer to clear override when room empties
      this.startOffTimerForOverrideClear();
    } else {
      // Lights OFF + button → turn ON at auto brightness (auto mode)
      this.clearOverrideMode();
      this.turnOn();
    }
  }

  // ============================================================
  // Brightness override detection
  // ============================================================

  private onBrightnessChanged(value: unknown): void {
    if (this.overrideMode) return;
    // Ignore brightness reports when lights are OFF (Zigbee periodic reporting)
    if (!isAnyLightOn(this.lightIds, this.ctx)) return;
    // Ignore echo: same value as what the recipe sent
    if (this.lastSentBrightness !== null && Number(value) === this.lastSentBrightness) return;

    this.overrideMode = true;
    this.ctx.state.set("overrideMode", true);
    this.ctx.notifyStateChanged();
    this.ctx.log("Manual brightness change detected — entering override mode");
  }

  // ============================================================
  // Override management
  // ============================================================

  private clearOverrideMode(): void {
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
      // Turn off lights if still on
      if (isAnyLightOn(this.lightIds, this.ctx)) {
        this.selfTriggeredLight = true;
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

  /** Reset failsafe timer on continued motion — countdown restarts from last motion. */
  private resetFailsafeTimer(): void {
    if (this.maxOnDurationMs === null) return;
    if (!this.failsafeTimer) return; // no active failsafe to reset
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
    this.selfTriggeredLight = true;
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
