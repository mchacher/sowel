import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { MotionLightBase, baseSlots, commonTrailingSlots } from "./engine/motion-light-base.js";

// ============================================================
// Motion-Light Recipe (Simple — on/off lights)
// ============================================================

export class MotionLightRecipe extends MotionLightBase {
  readonly id = "motion-light";
  readonly name = "Motion Light";
  readonly description =
    "Turns on lights when motion is detected, turns off after a timeout with no motion. Supports lux threshold, failsafe max-on duration, and button override.";

  readonly slots: RecipeSlotDef[] = [
    ...baseSlots(),
    {
      id: "lights",
      name: "Lights",
      description: "Lights to control (must belong to the selected zone)",
      type: "equipment",
      required: true,
      list: true,
      constraints: { equipmentType: "light_onoff" },
    },
    ...commonTrailingSlots(),
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Lumière sur mouvement",
      description:
        "Allume les lumières quand un mouvement est détecté, éteint après un délai sans mouvement. Supporte un seuil de luminosité optionnel et une durée max d'allumage.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        lights: {
          name: "Lumières",
          description: "Lumières à contrôler (doivent appartenir à la zone)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant extinction" },
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
    },
  };
}
