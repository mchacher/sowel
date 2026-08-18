/** Does this equipment type need a detail bottom sheet on mobile? */
export function needsDetailSheet(equipmentType: string): boolean {
  return [
    "light_dimmable",
    "light_color",
    "shutter",
    "awning",
    "pool_cover",
    "thermostat",
    "pool_heat_pump",
    "heater",
    // Spec 153 — VMC has a 3-way OFF/V1/V2 selector, not a single toggle.
    "vmc",
  ].includes(equipmentType);
}
