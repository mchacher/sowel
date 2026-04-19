/** Does this equipment type need a detail bottom sheet on mobile? */
export function needsDetailSheet(equipmentType: string): boolean {
  return [
    "light_dimmable",
    "light_color",
    "shutter",
    "pool_cover",
    "thermostat",
    "heater",
  ].includes(equipmentType);
}
