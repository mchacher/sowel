import type { EquipmentFamily, EquipmentType } from "../types";

/**
 * Spec 208 — equipment families.
 *
 * An equipment belongs to the family of what it acts on or measures: the light,
 * the openings, the air, the water, the energy, the information. The Maison
 * view groups equipments by family, one section each, named after it; the
 * family colours the section title and the row tiles. Equipments that act on
 * none of these sit in neutral sections, without a colour.
 *
 * Only a `switch` stores a family (`Equipment.family`): the same plug drives a
 * radiator in one room and a router in another.
 */

export const EQUIPMENT_FAMILIES: readonly EquipmentFamily[] = [
  "lighting",
  "openings",
  "climate",
  "water",
  "energy",
  "sensors",
];

export type SectionId =
  EquipmentFamily | "media" | "appliances" | "plugs" | "controls" | "displays" | "other";

export interface EquipmentSection {
  id: SectionId;
  labelKey: string;
  family: EquipmentFamily | null;
}

/** The Maison sections, in display order; `other` catches a type this UI does not know. */
export const SECTIONS: readonly EquipmentSection[] = [
  ...EQUIPMENT_FAMILIES.map((f) => ({ id: f, labelKey: `equipments.family.${f}`, family: f })),
  ...(["media", "appliances", "plugs", "controls", "displays", "other"] as const).map((id) => ({
    id,
    labelKey: `equipments.section.${id}`,
    family: null,
  })),
];

/** Every type's section (FR1 of spec 208). A family section means the type has that family. */
export const TYPE_SECTION: Record<EquipmentType, SectionId> = {
  light_onoff: "lighting",
  light_dimmable: "lighting",
  light_color: "lighting",
  shutter: "openings",
  awning: "openings",
  door: "openings",
  gate: "openings",
  pool_cover: "openings",
  thermostat: "climate",
  heater: "climate",
  vmc: "climate",
  // A water heater and a pool heat pump heat water.
  water_valve: "water",
  pool_pump: "water",
  pool_heat_pump: "water",
  water_heater: "water",
  // A charger and a vehicle store and draw energy.
  main_energy_meter: "energy",
  energy_meter: "energy",
  energy_production_meter: "energy",
  solar_panel: "energy",
  ups: "energy",
  ev_charger: "energy",
  electric_vehicle: "energy",
  // A camera observes; it commands nothing.
  sensor: "sensors",
  weather: "sensors",
  weather_forecast: "sensors",
  camera: "sensors",
  media_player: "media",
  appliance: "appliances",
  switch: "plugs",
  // A button is a control, not a measure.
  button: "controls",
  display: "displays",
};

interface FamilyCarrier {
  type: EquipmentType;
  family?: EquipmentFamily | null;
}

function isFamily(value: unknown): value is EquipmentFamily {
  return EQUIPMENT_FAMILIES.includes(value as EquipmentFamily);
}

/** The section an equipment is shown in: a switch's family, else its type's section. */
export function sectionOf(eq: FamilyCarrier): SectionId {
  if (eq.type === "switch" && isFamily(eq.family)) return eq.family;
  return TYPE_SECTION[eq.type] ?? "other";
}

/** The equipment's family, or null for a neutral section. */
export function familyOf(eq: FamilyCarrier): EquipmentFamily | null {
  const section = sectionOf(eq);
  return isFamily(section) ? section : null;
}

interface FamilyClasses {
  /** Tile and title chip at rest. */
  tile: string;
  /** Tile while the equipment runs. */
  tileRunning: string;
  /** Section title and its icon. */
  ink: string;
}

// Literal strings, so Tailwind's scanner emits every class.
export const FAMILY_CLASSES: Record<EquipmentFamily, FamilyClasses> = {
  lighting: {
    tile: "bg-fam-lighting-50 text-fam-lighting-ink",
    tileRunning: "bg-fam-lighting-fill text-fam-lighting-on",
    ink: "text-fam-lighting-ink",
  },
  openings: {
    tile: "bg-fam-openings-50 text-fam-openings-ink",
    tileRunning: "bg-fam-openings-fill text-fam-openings-on",
    ink: "text-fam-openings-ink",
  },
  climate: {
    tile: "bg-fam-climate-50 text-fam-climate-ink",
    tileRunning: "bg-fam-climate-fill text-fam-climate-on",
    ink: "text-fam-climate-ink",
  },
  water: {
    tile: "bg-fam-water-50 text-fam-water-ink",
    tileRunning: "bg-fam-water-fill text-fam-water-on",
    ink: "text-fam-water-ink",
  },
  energy: {
    tile: "bg-fam-energy-50 text-fam-energy-ink",
    tileRunning: "bg-fam-energy-fill text-fam-energy-on",
    ink: "text-fam-energy-ink",
  },
  sensors: {
    tile: "bg-fam-sensors-50 text-fam-sensors-ink",
    tileRunning: "bg-fam-sensors-fill text-fam-sensors-on",
    ink: "text-fam-sensors-ink",
  },
};

/** A neutral tile never changes: the state is read on the controls and the pills. */
export const NEUTRAL_TILE = "bg-border-light text-text-secondary";

/** Background and icon classes of an equipment tile. */
export function tileClasses(family: EquipmentFamily | null, running: boolean): string {
  if (!family) return NEUTRAL_TILE;
  return running ? FAMILY_CLASSES[family].tileRunning : FAMILY_CLASSES[family].tile;
}
