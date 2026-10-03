/**
 * Spec 182 — what a Sowel EV charger is.
 *
 * Integrations expose protocol-specific keys; the equipment model provides a
 * strict, integration-agnostic contract the UI, the recipes and the arbiter
 * rely on. For `ev_charger` that contract lives here and nowhere else:
 * `bindingUtils`, the type metadata and the charger surfaces import it rather
 * than restating it (the spec 177 pattern).
 *
 * Every point is identified by its CATEGORY, never by a vendor key: a plugin
 * that wants its device to be an EV charger publishes these categories.
 * Everything else bound on a charger is an EXTRA: it stays bound and visible,
 * varies from one charger to the next, and no core code path, card layout or
 * recipe contract may key off it.
 *
 * Pure TypeScript, no backend dependency: the UI bundles it directly.
 */

/**
 * The vehicle as the charger sees it on its pilot line (IEC 61851):
 * A → `disconnected`; B → `connected` (plugged in, not drawing: waiting,
 * paused, full or refused); C/D → `charging`. A plugin resolves its own status
 * vocabulary to exactly one value. Error states are not a vehicle state.
 */
export const EV_VEHICLE_STATE_VALUES = ["disconnected", "connected", "charging"] as const;
export type EvVehicleState = (typeof EV_VEHICLE_STATE_VALUES)[number];

export function isEvVehicleState(value: unknown): value is EvVehicleState {
  return (
    typeof value === "string" && (EV_VEHICLE_STATE_VALUES as readonly string[]).includes(value)
  );
}

/** The contract aliases. `temperature` is not core: it is pinned so it never joins a zone average. */
export const EV_CHARGER_ALIASES = {
  state: "state",
  vehicle: "vehicle",
  power: "power",
  energy: "energy",
  chargeCurrent: "charge_current",
  sessionEnergy: "session_energy",
  current: "current",
  voltage: "voltage",
  temperature: "charger_temperature",
} as const;

export const EV_VEHICLE_STATE_CATEGORY = "ev_vehicle_state";
export const EV_CHARGE_CURRENT_CATEGORY = "ev_charge_current";
export const EV_SESSION_ENERGY_CATEGORY = "ev_session_energy";
export const SET_EV_CHARGE_CURRENT_CATEGORY = "set_ev_charge_current";

/**
 * Category → contract alias, for data and orders alike (the two category
 * namespaces are disjoint). This is how a device's points become the
 * charger's aliases, whatever the plugin calls its keys.
 */
export const EV_CHARGER_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  // Start / stop: the state the charger reports, and the command.
  appliance_state: EV_CHARGER_ALIASES.state,
  light_state: EV_CHARGER_ALIASES.state,
  toggle_power: EV_CHARGER_ALIASES.state,
  light_toggle: EV_CHARGER_ALIASES.state,
  [EV_VEHICLE_STATE_CATEGORY]: EV_CHARGER_ALIASES.vehicle,
  power: EV_CHARGER_ALIASES.power,
  energy: EV_CHARGER_ALIASES.energy,
  [EV_CHARGE_CURRENT_CATEGORY]: EV_CHARGER_ALIASES.chargeCurrent,
  [SET_EV_CHARGE_CURRENT_CATEGORY]: EV_CHARGER_ALIASES.chargeCurrent,
  [EV_SESSION_ENERGY_CATEGORY]: EV_CHARGER_ALIASES.sessionEnergy,
  current: EV_CHARGER_ALIASES.current,
  voltage: EV_CHARGER_ALIASES.voltage,
  temperature: EV_CHARGER_ALIASES.temperature,
  temperature_device: EV_CHARGER_ALIASES.temperature,
};

export interface EvChargerCoreEntry {
  alias: string;
  /** The alias exists on the data side (a reading). */
  data: boolean;
  /** The alias exists on the order side (a command). */
  order: boolean;
}

/** The core, one row per alias; meanings in specs/182-ev-charger-equipment/spec.md. */
export const EV_CHARGER_CORE: readonly EvChargerCoreEntry[] = [
  { alias: EV_CHARGER_ALIASES.state, data: true, order: true },
  { alias: EV_CHARGER_ALIASES.vehicle, data: true, order: false },
  { alias: EV_CHARGER_ALIASES.power, data: true, order: false },
  { alias: EV_CHARGER_ALIASES.energy, data: true, order: false },
  { alias: EV_CHARGER_ALIASES.chargeCurrent, data: true, order: true },
  { alias: EV_CHARGER_ALIASES.sessionEnergy, data: true, order: false },
  { alias: EV_CHARGER_ALIASES.current, data: true, order: false },
  { alias: EV_CHARGER_ALIASES.voltage, data: true, order: false },
];

const CORE_DATA_ALIASES: ReadonlySet<string> = new Set(
  EV_CHARGER_CORE.filter((e) => e.data).map((e) => e.alias),
);
const CORE_ORDER_ALIASES: ReadonlySet<string> = new Set(
  EV_CHARGER_CORE.filter((e) => e.order).map((e) => e.alias),
);

/**
 * Identity. A device is an EV charger when it reports a vehicle state or
 * accepts a charging current — categories a plugin declares, never a vendor
 * key. A plain relay or a metered plug is not offered (it can still be bound
 * by hand).
 */
export const EV_CHARGER_IDENTITY_DATA_CATEGORY = EV_VEHICLE_STATE_CATEGORY;
export const EV_CHARGER_IDENTITY_ORDER_CATEGORY = SET_EV_CHARGE_CURRENT_CATEGORY;

export function isEvChargerDevice(
  data: readonly { category?: string | null }[],
  orders: readonly { category?: string | null }[],
): boolean {
  return (
    data.some((d) => d.category === EV_CHARGER_IDENTITY_DATA_CATEGORY) ||
    orders.some((o) => o.category === EV_CHARGER_IDENTITY_ORDER_CATEGORY)
  );
}

/**
 * Bounds of a charging-current order that does not declare its own: the IEC
 * 61851 floor and the common single-phase ceiling.
 */
export const EV_CHARGE_CURRENT_FALLBACK = { min: 6, max: 32 } as const;

/** The bindings that are NOT the core, each side sorted by alias. */
export function splitEvChargerExtras<D extends { alias: string }, O extends { alias: string }>(
  dataBindings: readonly D[],
  orderBindings: readonly O[],
): { extraData: D[]; extraOrders: O[] } {
  const byAlias = (a: { alias: string }, b: { alias: string }) => a.alias.localeCompare(b.alias);
  return {
    extraData: dataBindings.filter((b) => !CORE_DATA_ALIASES.has(b.alias)).sort(byAlias),
    extraOrders: orderBindings.filter((b) => !CORE_ORDER_ALIASES.has(b.alias)).sort(byAlias),
  };
}
