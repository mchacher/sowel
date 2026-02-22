import type { DataCategory, Z2MExpose } from "../shared/types.js";
import { PROPERTY_TO_CATEGORY, LIGHT_INDICATOR_PROPERTIES } from "../shared/constants.js";

/**
 * Infer the DataCategory for a z2m expose property.
 *
 * @param property - The property name from zigbee2mqtt expose
 * @param allProperties - All property names on the same device (for context)
 * @param parentExposeType - The parent expose type (e.g. "light", "switch") for context
 * @returns The inferred DataCategory
 */
export function inferCategory(
  property: string,
  allProperties: Set<string>,
  parentExposeType?: string,
): DataCategory {
  // Special handling for "state": use parent expose type and sibling properties for context
  if (property === "state") {
    // If the state is inside a "light" or "switch" expose, it's light_state
    // (switches/relays are on/off devices commonly used to control lights)
    if (parentExposeType === "light" || parentExposeType === "switch") return "light_state";

    // Fallback: check if sibling properties indicate a light device
    const hasLightProperties = [...LIGHT_INDICATOR_PROPERTIES].some((p) => allProperties.has(p));
    return hasLightProperties ? "light_state" : "generic";
  }

  return PROPERTY_TO_CATEGORY[property] ?? "generic";
}

/**
 * Collect all property names from a z2m expose array (including nested features).
 */
export function collectProperties(exposes: Z2MExpose[]): Set<string> {
  const props = new Set<string>();

  for (const expose of exposes) {
    if (expose.property) {
      props.add(expose.property);
    }
    if (expose.features) {
      for (const prop of collectProperties(expose.features)) {
        props.add(prop);
      }
    }
  }

  return props;
}
