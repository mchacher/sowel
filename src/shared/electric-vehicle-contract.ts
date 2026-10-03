/**
 * Spec 183 — what a Sowel electric vehicle is.
 *
 * Battery-electric and plug-in hybrid cars alike: anything that plugs in. The
 * contract lives here and nowhere else — binding code, the type metadata and
 * the vehicle surfaces import it (the spec 177 / 182 pattern).
 *
 * Every point is identified by its CATEGORY, never by a maker's key. Anything
 * else a plugin binds (fuel, climate, tyre pressures, raw codes) is an EXTRA:
 * bound and visible, and nothing in the core keys off it.
 *
 * A vehicle is neither a meter nor a flexible load: the charger (spec 182)
 * measures the energy and is the load. Pure TypeScript, bundled by the UI.
 */

/**
 * What the car says about charging. A plugin resolves its maker's codes to
 * exactly one value. `waiting` — plugged, ready, waiting for the charger to
 * deliver — is the state a sleeping car is left in, which is how a recipe
 * recognises the car it must wake.
 */
export const EV_CHARGING_STATE_VALUES = [
  "unplugged",
  "idle",
  "scheduled",
  "waiting",
  "charging",
  "completed",
  "error",
] as const;
export type EvChargingState = (typeof EV_CHARGING_STATE_VALUES)[number];

export function isEvChargingState(value: unknown): value is EvChargingState {
  return (
    typeof value === "string" && (EV_CHARGING_STATE_VALUES as readonly string[]).includes(value)
  );
}

export const ELECTRIC_VEHICLE_ALIASES = {
  batteryLevel: "battery_level",
  range: "range",
  plugged: "plugged",
  chargingState: "charging_state",
  reportedAt: "reported_at",
  atHome: "at_home",
  mileage: "mileage",
  /** Data (the car's own limit) and order (set it) share the alias. */
  chargeLimit: "charge_limit",
  wake: "wake",
  chargeStart: "charge_start",
  /** Spec 184 — read the latest report now; never wakes the car. */
  refresh: "refresh",
} as const;

export const EV_BATTERY_LEVEL_CATEGORY = "ev_battery_level";
export const EV_RANGE_CATEGORY = "ev_range";
export const EV_PLUGGED_CATEGORY = "ev_plugged";
export const EV_CHARGING_STATE_CATEGORY = "ev_charging_state";
export const EV_REPORTED_AT_CATEGORY = "ev_reported_at";
export const EV_AT_HOME_CATEGORY = "ev_at_home";
export const EV_MILEAGE_CATEGORY = "ev_mileage";
export const EV_CHARGE_LIMIT_CATEGORY = "ev_charge_limit";
export const EV_WAKE_CATEGORY = "ev_wake";
export const EV_CHARGE_START_CATEGORY = "ev_charge_start";
export const SET_EV_CHARGE_LIMIT_CATEGORY = "set_ev_charge_limit";
export const EV_REFRESH_CATEGORY = "ev_refresh";

/** Momentary orders: no value to show, only the action (activity feed). */
export const EV_MOMENTARY_ORDER_CATEGORIES: ReadonlySet<string> = new Set([
  EV_WAKE_CATEGORY,
  EV_CHARGE_START_CATEGORY,
  EV_REFRESH_CATEGORY,
]);

/** Category → contract alias, data and orders alike (disjoint namespaces). */
export const ELECTRIC_VEHICLE_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  [EV_BATTERY_LEVEL_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.batteryLevel,
  [EV_RANGE_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.range,
  [EV_PLUGGED_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.plugged,
  [EV_CHARGING_STATE_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.chargingState,
  [EV_REPORTED_AT_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.reportedAt,
  [EV_AT_HOME_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.atHome,
  [EV_MILEAGE_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.mileage,
  [EV_CHARGE_LIMIT_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.chargeLimit,
  [SET_EV_CHARGE_LIMIT_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.chargeLimit,
  [EV_WAKE_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.wake,
  [EV_CHARGE_START_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.chargeStart,
  [EV_REFRESH_CATEGORY]: ELECTRIC_VEHICLE_ALIASES.refresh,
};

export interface ElectricVehicleCoreEntry {
  alias: string;
  data: boolean;
  order: boolean;
}

/** The core, one row per alias; meanings in specs/183-electric-vehicle-equipment/spec.md. */
export const ELECTRIC_VEHICLE_CORE: readonly ElectricVehicleCoreEntry[] = [
  { alias: ELECTRIC_VEHICLE_ALIASES.batteryLevel, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.range, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.plugged, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.chargingState, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.reportedAt, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.atHome, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.mileage, data: true, order: false },
  { alias: ELECTRIC_VEHICLE_ALIASES.chargeLimit, data: true, order: true },
  { alias: ELECTRIC_VEHICLE_ALIASES.wake, data: false, order: true },
  { alias: ELECTRIC_VEHICLE_ALIASES.chargeStart, data: false, order: true },
  { alias: ELECTRIC_VEHICLE_ALIASES.refresh, data: false, order: true },
];

const CORE_DATA_ALIASES: ReadonlySet<string> = new Set(
  ELECTRIC_VEHICLE_CORE.filter((e) => e.data).map((e) => e.alias),
);
const CORE_ORDER_ALIASES: ReadonlySet<string> = new Set(
  ELECTRIC_VEHICLE_CORE.filter((e) => e.order).map((e) => e.alias),
);

/**
 * Identity: a device is an electric vehicle when it reports a traction-battery
 * level. Not `battery` — that is a device battery, watched by the low-battery
 * monitor (spec 143).
 */
export const ELECTRIC_VEHICLE_IDENTITY_DATA_CATEGORY = EV_BATTERY_LEVEL_CATEGORY;

export function isElectricVehicleDevice(
  data: readonly { category?: string | null }[],
  _orders: readonly { category?: string | null }[] = [],
): boolean {
  return data.some((d) => d.category === ELECTRIC_VEHICLE_IDENTITY_DATA_CATEGORY);
}

/** Beyond this age the surfaces say how old the car's own report is (FR7). */
export const EV_REPORT_STALE_MS = 15 * 60_000;

/** Bounds of a charge-limit order that does not declare its own. */
export const EV_CHARGE_LIMIT_FALLBACK = { min: 50, max: 100 } as const;

/** The bindings that are NOT the core, each side sorted by alias. */
export function splitElectricVehicleExtras<
  D extends { alias: string },
  O extends { alias: string },
>(dataBindings: readonly D[], orderBindings: readonly O[]): { extraData: D[]; extraOrders: O[] } {
  const byAlias = (a: { alias: string }, b: { alias: string }) => a.alias.localeCompare(b.alias);
  return {
    extraData: dataBindings.filter((b) => !CORE_DATA_ALIASES.has(b.alias)).sort(byAlias),
    extraOrders: orderBindings.filter((b) => !CORE_ORDER_ALIASES.has(b.alias)).sort(byAlias),
  };
}
