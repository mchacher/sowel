import type { EquipmentType, HistoryBindingState } from "../../types";

/**
 * The series the equipment page opens by default, over 24 h (spec 196,
 * decision pr9-graphique): the answer to « what has it been doing since this
 * morning? ». Chosen by category, in order of preference, among the historized
 * bindings; an alias wins over a category where the type has a contract alias
 * for it (a pool heat pump's water temperature).
 *
 * Types with no obvious main series (a light, a gate) open nothing.
 */
const PREFERENCES: Partial<Record<EquipmentType, { aliases?: string[]; categories: string[] }>> = {
  thermostat: { aliases: ["temperature"], categories: ["temperature"] },
  heater: { aliases: ["temperature"], categories: ["temperature"] },
  sensor: { categories: ["temperature", "humidity", "co2", "luminosity"] },
  weather: { categories: ["temperature", "temperature_outdoor", "rain", "wind"] },
  ev_charger: { aliases: ["power"], categories: ["power"] },
  shutter: { categories: ["shutter_position"] },
  awning: { categories: ["shutter_position"] },
  pool_cover: { categories: ["shutter_position"] },
  electric_vehicle: { categories: ["battery"] },
  pool_heat_pump: { aliases: ["effective_water_temperature", "water_temperature"], categories: ["temperature"] },
  main_energy_meter: { categories: ["power"] },
  energy_meter: { categories: ["power"] },
  energy_production_meter: { categories: ["power"] },
  switch: { categories: ["power"] },
  water_heater: { categories: ["power", "temperature"] },
  solar_panel: { categories: ["power"] },
};

/** Never charted (see HistoryPanel): the energy delta is internal. */
const INTERNAL_ALIASES = new Set(["energy"]);

/** A setpoint may carry a temperature category: it is what was asked, not what is. */
const NEVER_MAIN = new Set(["setpoint"]);

export function mainHistoryAlias(
  type: EquipmentType,
  bindings: readonly Pick<HistoryBindingState, "alias" | "category" | "effectiveOn">[],
): string | undefined {
  const pref = PREFERENCES[type];
  if (!pref) return undefined;
  const charted = bindings.filter((b) => b.effectiveOn && !INTERNAL_ALIASES.has(b.alias));
  for (const alias of pref.aliases ?? []) {
    if (charted.some((b) => b.alias === alias)) return alias;
  }
  for (const category of pref.categories) {
    const hit = charted.find((b) => b.category === category && !NEVER_MAIN.has(b.alias));
    if (hit) return hit.alias;
  }
  return undefined;
}
