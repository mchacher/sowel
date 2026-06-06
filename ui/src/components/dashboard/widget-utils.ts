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
    "solar_panel",
  ].includes(equipmentType);
}
