import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import type { RecipeContext } from "./engine/recipe.js";
import { MotionLightBase, baseSlots, commonTrailingSlots } from "./engine/motion-light-base.js";
import { isAnyLightOn, turnOnLights, setLightsBrightness } from "./engine/light-helpers.js";

// ============================================================
// Motion-Light Dimmable Recipe (advanced — brightness + time slots)
// ============================================================

interface BrightnessSlot {
  start: string;
  end: string;
  brightness: number;
}

function makeSlotFields(n: number): RecipeSlotDef[] {
  return [
    {
      id: `slot${n}Start`,
      name: `Slot ${n} Start`,
      description: `Start time for brightness slot ${n} (HH:MM)`,
      type: "time",
      required: false,
      group: `slot${n}`,
    },
    {
      id: `slot${n}End`,
      name: `Slot ${n} End`,
      description: `End time for brightness slot ${n} (HH:MM)`,
      type: "time",
      required: false,
      group: `slot${n}`,
    },
    {
      id: `slot${n}Brightness`,
      name: `Slot ${n} Brightness`,
      description: `Brightness level during slot ${n} (1-254)`,
      type: "number",
      required: false,
      constraints: { min: 1, max: 254 },
      group: `slot${n}`,
    },
  ];
}

export class MotionLightDimmableRecipe extends MotionLightBase {
  readonly id = "motion-light-dimmable";
  readonly name = "Motion Light (Dimmable)";
  readonly description =
    "Turns on dimmable lights when motion is detected with brightness control. Supports up to 3 brightness time slots, manual brightness override detection, lux threshold, and button toggle.";

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
      description: "Default brightness level when no time slot matches (1-254)",
      type: "number",
      required: false,
      constraints: { min: 1, max: 254 },
    },
    ...commonTrailingSlots().slice(1), // luxThreshold, maxOnDuration, buttons, disableWhenDaylight
    ...makeSlotFields(1),
    ...makeSlotFields(2),
    ...makeSlotFields(3),
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Lumière dimmable sur mouvement",
      description:
        "Allume les lumières dimmables quand un mouvement est détecté avec contrôle de luminosité. Supporte jusqu'à 3 plages horaires de luminosité, détection de changement manuel, seuil de luminosité et boutons.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        lights: {
          name: "Lumières",
          description: "Lumières dimmables à contrôler (doivent appartenir à la zone)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant extinction" },
        brightness: {
          name: "Luminosité",
          description: "Luminosité par défaut hors plages horaires (1-254)",
        },
        slot1Start: { name: "Début", description: "Heure de début de la plage 1" },
        slot1End: { name: "Fin", description: "Heure de fin de la plage 1" },
        slot1Brightness: {
          name: "Luminosité",
          description: "Luminosité pendant la plage 1 (1-254)",
        },
        slot2Start: { name: "Début", description: "Heure de début de la plage 2" },
        slot2End: { name: "Fin", description: "Heure de fin de la plage 2" },
        slot2Brightness: {
          name: "Luminosité",
          description: "Luminosité pendant la plage 2 (1-254)",
        },
        slot3Start: { name: "Début", description: "Heure de début de la plage 3" },
        slot3End: { name: "Fin", description: "Heure de fin de la plage 3" },
        slot3Brightness: {
          name: "Luminosité",
          description: "Luminosité pendant la plage 3 (1-254)",
        },
        luxThreshold: {
          name: "Seuil lux (max)",
          description: "Au-dessus de ce seuil, les lumières ne s'allument pas",
        },
        maxOnDuration: {
          name: "Extinction auto (sécurité)",
          description: "Coupe les lumières après cette durée même avec mouvement — anti-oubli",
        },
        buttons: {
          name: "Interrupteurs",
          description: "Interrupteurs physiques pour allumer/éteindre manuellement",
        },
        disableWhenDaylight: {
          name: "Inactif le jour",
          description: "Ne pas allumer pendant la journée (basé sur lever/coucher du soleil)",
        },
      },
      groups: {
        slot1: "Plage 1",
        slot2: "Plage 2",
        slot3: "Plage 3",
      },
    },
  };

  // Dimmable-specific state
  private brightness: number | null = null;
  private brightnessSlots: BrightnessSlot[] = [];
  private lastSentBrightness: number | null = null;
  /** Grace period: ignore brightness echoes for 5s after we send a brightness command */
  private brightnessGraceUntil = 0;

  // ============================================================
  // Dimmable-specific validation
  // ============================================================

  protected override validateExtra(params: Record<string, unknown>, _ctx: RecipeContext): void {
    const { brightness } = params;

    if (brightness !== undefined && brightness !== null && brightness !== "") {
      const b = Number(brightness);
      if (isNaN(b) || b < 1 || b > 254) {
        throw new Error("brightness must be between 1 and 254");
      }
    }

    for (let i = 1; i <= 3; i++) {
      const start = params[`slot${i}Start`];
      const end = params[`slot${i}End`];
      const slotBrightness = params[`slot${i}Brightness`];

      const hasStart = start !== undefined && start !== null && start !== "";
      const hasEnd = end !== undefined && end !== null && end !== "";
      const hasBrightness =
        slotBrightness !== undefined && slotBrightness !== null && slotBrightness !== "";

      const provided = [hasStart, hasEnd, hasBrightness];
      const anyProvided = provided.some(Boolean);
      const allProvided = provided.every(Boolean);

      if (anyProvided && !allProvided) {
        throw new Error(
          `Slot ${i}: start, end, and brightness must all be provided or all omitted`,
        );
      }

      if (hasStart && typeof start === "string" && !/^\d{2}:\d{2}$/.test(start)) {
        throw new Error(`slot${i}Start must be in HH:MM format`);
      }
      if (hasEnd && typeof end === "string" && !/^\d{2}:\d{2}$/.test(end)) {
        throw new Error(`slot${i}End must be in HH:MM format`);
      }
      if (hasBrightness) {
        const b = Number(slotBrightness);
        if (isNaN(b) || b < 1 || b > 254) {
          throw new Error(`slot${i}Brightness must be between 1 and 254`);
        }
      }
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

    this.brightnessSlots = [];
    for (let i = 1; i <= 3; i++) {
      const start = params[`slot${i}Start`];
      const end = params[`slot${i}End`];
      const slotBrightness = params[`slot${i}Brightness`];
      if (
        typeof start === "string" &&
        start &&
        typeof end === "string" &&
        end &&
        slotBrightness !== undefined &&
        slotBrightness !== null &&
        slotBrightness !== ""
      ) {
        this.brightnessSlots.push({
          start,
          end,
          brightness: Number(slotBrightness),
        });
      }
    }

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
    this.brightnessGraceUntil = 0;
    this.brightnessSlots = [];
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
      this.brightnessGraceUntil = Date.now() + 5000;
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
  // Brightness resolution — first matching slot wins
  // ============================================================

  private getTargetBrightness(): number | null {
    if (this.brightness === null) return null;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const slot of this.brightnessSlots) {
      const [startH, startM] = slot.start.split(":").map(Number);
      const [endH, endM] = slot.end.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes <= endMinutes) {
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return slot.brightness;
        }
      } else {
        // Wraparound (e.g. 23:30 → 06:00)
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return slot.brightness;
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
    if (Date.now() < this.brightnessGraceUntil) return;
    if (Number(value) === this.lastSentBrightness) return;

    this.overrideMode = true;
    this.ctx.state.set("overrideMode", true);
    this.ctx.notifyStateChanged();
    this.ctx.log("Manual brightness change detected — entering override mode");
  }
}
