import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";
import { parseDuration, formatDuration } from "./engine/duration.js";
import { isAnyLightOn, turnOnLights, turnOffLights } from "./engine/light-helpers.js";

// ============================================================
// Switch-Light Recipe
// ============================================================

export class SwitchLightRecipe extends Recipe {
  readonly id = "switch-light";
  readonly name = "Switch Light";
  readonly description =
    "Lights follow manual commands — any button press toggles lights on/off. For rooms without motion sensors, controlled via wall switches, remotes, or smart buttons.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone containing the lights",
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
      id: "buttons",
      name: "Buttons",
      description: "Button/switch equipments that trigger toggle",
      type: "equipment",
      required: true,
      list: true,
      constraints: { equipmentType: "button" },
    },
    {
      id: "maxOnDuration",
      name: "Max On Duration",
      description: "Force lights off after this duration (optional failsafe)",
      type: "duration",
      required: false,
    },
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Lumière sur interrupteur",
      description:
        "Les lumières suivent les commandes manuelles — un appui sur un bouton bascule les lumières on/off. Pour les pièces sans capteur de mouvement, contrôlées par interrupteurs ou télécommandes.",
      slots: {
        zone: { name: "Zone", description: "Zone contenant les lumières" },
        lights: {
          name: "Lumières",
          description: "Lumières à contrôler (doivent appartenir à la zone)",
        },
        buttons: {
          name: "Interrupteurs",
          description: "Interrupteurs physiques pour allumer/éteindre",
        },
        maxOnDuration: {
          name: "Extinction auto (sécurité)",
          description: "Coupe les lumières après cette durée — anti-oubli",
        },
      },
    },
  };

  private unsubs: (() => void)[] = [];
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  private ctx!: RecipeContext;
  private lightIds!: string[];
  private buttonIds!: string[];
  private maxOnDurationMs: number | null = null;

  // ============================================================
  // Validation
  // ============================================================

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, lights, buttons, maxOnDuration } = params;

    // Validate zone
    if (!zone || typeof zone !== "string") {
      throw new Error("Zone parameter is required");
    }
    const zoneObj = ctx.zoneManager.getById(zone);
    if (!zoneObj) {
      throw new Error(`Zone not found: ${zone}`);
    }

    // Validate lights
    const lightIds = this.normalizeStringArray(lights);
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

    // Validate buttons
    const buttonIds = this.normalizeStringArray(buttons);
    if (buttonIds.length === 0) {
      throw new Error("At least one button is required");
    }
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

    // Validate maxOnDuration
    if (maxOnDuration !== undefined && maxOnDuration !== null) {
      parseDuration(maxOnDuration);
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.ctx = ctx;
    this.lightIds = this.normalizeStringArray(params.lights);
    this.buttonIds = this.normalizeStringArray(params.buttons);
    this.maxOnDurationMs =
      params.maxOnDuration !== undefined && params.maxOnDuration !== null
        ? parseDuration(params.maxOnDuration)
        : null;

    // Listen to button actions → toggle
    const unsubButton = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (!this.buttonIds.includes(event.equipmentId)) return;
      if (event.alias !== "action") return;
      this.onButtonAction();
    });
    this.unsubs.push(unsubButton);

    // Listen to light state changes (for failsafe management)
    const unsubLight = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (!this.lightIds.includes(event.equipmentId)) return;
      if (event.alias !== "state") return;
      this.onLightChanged(event.value);
    });
    this.unsubs.push(unsubLight);
  }

  stop(): void {
    this.cancelFailsafeTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.ctx.state.delete("failsafeExpiresAt");
    this.ctx.notifyStateChanged();
  }

  // ============================================================
  // Helpers
  // ============================================================

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((id): id is string => typeof id === "string");
    }
    return [];
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onButtonAction(): void {
    if (isAnyLightOn(this.lightIds, this.ctx)) {
      const errors = turnOffLights(this.lightIds, this.ctx);
      if (errors.length > 0) {
        this.ctx.log(`Error turning off some lights: ${errors.join("; ")}`, "error");
      }
      this.ctx.log("Button pressed — lights toggled off");
      this.cancelFailsafeTimer();
      this.clearFailsafeTimerState();
    } else {
      const errors = turnOnLights(this.lightIds, this.ctx);
      if (errors.length > 0) {
        this.ctx.log(`Error turning on some lights: ${errors.join("; ")}`, "error");
      }
      this.ctx.log("Button pressed — lights toggled on");
      this.startFailsafeTimer();
    }
  }

  private onLightChanged(value: unknown): void {
    const lightOn = value === true || value === "ON";

    if (!lightOn) {
      if (!isAnyLightOn(this.lightIds, this.ctx)) {
        this.cancelFailsafeTimer();
        this.clearFailsafeTimerState();
      }
    } else if (lightOn && this.maxOnDurationMs !== null) {
      this.startFailsafeTimer();
    }
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
