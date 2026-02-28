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
}
