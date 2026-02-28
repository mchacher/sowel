import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import type { RecipeContext } from "./engine/recipe.js";
import { MotionLightBase, baseSlots, commonTrailingSlots } from "./engine/motion-light-base.js";
import { isAnyLightOn, turnOnLights, setLightsBrightness } from "./engine/light-helpers.js";

// ============================================================
// Motion-Light Dimmable Recipe (advanced — brightness + morning window)
// ============================================================

export class MotionLightDimmableRecipe extends MotionLightBase {
  readonly id = "motion-light-dimmable";
  readonly name = "Motion Light (Dimmable)";
  readonly description =
    "Turns on dimmable lights when motion is detected with brightness control. Supports brightness presets, morning window, manual brightness override detection, lux threshold, and button toggle.";

  readonly slots: RecipeSlotDef[] = [
    ...baseSlots(),
    {
      id: "lights",
      name: "Lights",
      description: "Dimmable lights to control (must belong to the selected zone)",
      type: "equipment",
      required: true,
      list: true,
      constraints: { equipmentType: ["light_dimmable", "light_color"] },
    },
    ...commonTrailingSlots().slice(0, 1), // timeout
    {
      id: "brightness",
      name: "Brightness",
      description: "Brightness level when turning on (1-254)",
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
    ...commonTrailingSlots().slice(1), // luxThreshold, maxOnDuration, buttons, disableWhenDaylight
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Lumière dimmable sur mouvement",
      description:
        "Allume les lumières dimmables quand un mouvement est détecté avec contrôle de luminosité. Supporte des presets de luminosité, plage matinale, détection de changement manuel, seuil de luminosité et boutons.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        lights: {
          name: "Lumières",
          description: "Lumières dimmables à contrôler (doivent appartenir à la zone)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant extinction" },
        brightness: {
          name: "Luminosité",
          description: "Niveau de luminosité à l'allumage (1-254)",
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
        buttons: {
          name: "Boutons",
          description: "Boutons / interrupteurs pour contrôle manuel (optionnel)",
        },
        disableWhenDaylight: {
          name: "Désactiver le jour",
          description:
            "Ne pas allumer les lumières quand il fait jour (basé sur lever/coucher du soleil et décalages dans les réglages)",
        },
      },
    },
  };

  // Dimmable-specific state
  private brightness: number | null = null;
  private morningBrightness: number | null = null;
  private morningStart: string | null = null;
  private morningEnd: string | null = null;
  private lastSentBrightness: number | null = null;

  // ============================================================
  // Dimmable-specific validation
  // ============================================================

  protected override validateExtra(params: Record<string, unknown>, _ctx: RecipeContext): void {
    const { brightness, morningBrightness, morningStart, morningEnd } = params;

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
  }

  // ============================================================
  // Dimmable-specific initialization
  // ============================================================

  protected override startExtra(params: Record<string, unknown>, ctx: RecipeContext): void {
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

    this.lastSentBrightness = null;

    // Listen to brightness changes for manual override detection
    if (this.brightness !== null) {
      const unsubBrightness = ctx.eventBus.onType("equipment.data.changed", (event) => {
        if (!this.lightIds.includes(event.equipmentId)) return;
        if (event.alias !== "brightness") return;
        this.onBrightnessChanged(event.value);
      });
      this.unsubs.push(unsubBrightness);
    }
  }

  // ============================================================
  // Dimmable-specific cleanup
  // ============================================================

  protected override stopExtra(): void {
    this.lastSentBrightness = null;
  }

  // ============================================================
  // Override turnOn — set brightness
  // ============================================================

  protected override doTurnOn(): void {
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
  }

  // ============================================================
  // Brightness resolution
  // ============================================================

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
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return this.morningBrightness;
        }
      } else {
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return this.morningBrightness;
        }
      }
    }

    return this.brightness;
  }

  // ============================================================
  // Brightness override detection
  // ============================================================

  private onBrightnessChanged(value: unknown): void {
    if (this.overrideMode) return;
    if (!isAnyLightOn(this.lightIds, this.ctx)) return;
    if (this.lastSentBrightness === null) return;
    if (Number(value) === this.lastSentBrightness) return;

    this.overrideMode = true;
    this.ctx.state.set("overrideMode", true);
    this.ctx.notifyStateChanged();
    this.ctx.log("Manual brightness change detected — entering override mode");
  }
}
