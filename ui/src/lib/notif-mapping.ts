import type { NotificationPublisherMapping, EquipmentWithDetails, RecipeInstance } from "../types";

/**
 * The zone dropdown in the notification mapping editor is only a selection aid —
 * it is not stored on the mapping (which keeps sourceType/sourceId/sourceKey).
 * Re-derive it from the mapping's source so re-editing shows the source's zone
 * instead of defaulting to "all zones".
 */
export function deriveSourceZoneFilter(
  mapping: Pick<NotificationPublisherMapping, "sourceType" | "sourceId">,
  equipments: EquipmentWithDetails[],
  recipeInstances: RecipeInstance[],
): string {
  if (mapping.sourceType === "equipment") {
    return equipments.find((e) => e.id === mapping.sourceId)?.zoneId ?? "";
  }
  if (mapping.sourceType === "recipe") {
    const zone = recipeInstances.find((i) => i.id === mapping.sourceId)?.params.zone;
    return typeof zone === "string" ? zone : "";
  }
  return "";
}
