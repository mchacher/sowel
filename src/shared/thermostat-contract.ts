/**
 * Spec 177 — what a Sowel thermostat is.
 *
 * Integrations expose protocol-specific keys; the equipment model provides a
 * strict, integration-agnostic contract the UI, the recipes and the zone
 * orders rely on. For `thermostat` that contract lives here and nowhere else:
 * `bindingUtils`, `DeviceSelector`, `binding-candidates` and `ThermostatCard`
 * import it rather than restating it.
 *
 * Everything bound on a thermostat that is not in the core is an EXTRA: it
 * stays bound and usable, varies from one equipment to the next, and defines
 * nothing. No core code path, no recipe contract and no card layout may key
 * off an extra — that is how two vendors' vocabularies (`nanoe`, `airSwingUD`,
 * `profile`, `resetAlarm`) became the definition of a thermostat before this
 * spec, and what spec 176 ended up paying for.
 *
 * Pure TypeScript, no backend dependency: the UI bundles it directly (the
 * spec 150 pattern for binding-candidates.ts).
 */

/**
 * Spec 176 — alias for a thermostat's boolean run state: the SAME `state`
 * alias every relay-style equipment already uses for on/off, not a new name.
 * On a submetered thermostat the `power` alias is the wattage read from a
 * clamp (the metering convention), so the on/off state the device reports
 * about itself binds here instead.
 */
export const THERMOSTAT_STATE_ALIAS = "state";

export interface ThermostatCoreEntry {
  alias: string;
  /** The alias exists on the data side (a reading). */
  data: boolean;
  /** The alias exists on the order side (a command). */
  order: boolean;
  /** Present on many units, required on none. */
  optional?: boolean;
}

/**
 * The core, one row per alias. The meaning of each row is in
 * specs/177-thermostat-contract/spec.md (FR1); in short:
 *
 * - `temperature`        data          the measured room temperature
 * - `setpoint`           data + order  the target temperature (categories
 *                                      `setpoint` / `set_setpoint`)
 * - `state`              data          the boolean run state the device
 *                                      reports about itself (spec 176)
 * - `power`              data + order  order: the on/off command
 *                                      (`toggle_power`); data: the wattage on
 *                                      a submetered unit, or the legacy
 *                                      boolean bound before spec 176
 * - `operationMode`      data + order  heat / cool / auto / dry / fan; the
 *                                      values are the plugin's until #922
 * - `outsideTemperature` data          optional outdoor probe
 */
export const THERMOSTAT_CORE: readonly ThermostatCoreEntry[] = [
  { alias: "temperature", data: true, order: false },
  { alias: "setpoint", data: true, order: true },
  { alias: THERMOSTAT_STATE_ALIAS, data: true, order: false },
  { alias: "power", data: true, order: true },
  { alias: "operationMode", data: true, order: true },
  { alias: "outsideTemperature", data: true, order: false, optional: true },
];

export const THERMOSTAT_CORE_DATA_ALIASES: ReadonlySet<string> = new Set(
  THERMOSTAT_CORE.filter((e) => e.data).map((e) => e.alias),
);

export const THERMOSTAT_CORE_ORDER_ALIASES: ReadonlySet<string> = new Set(
  THERMOSTAT_CORE.filter((e) => e.order).map((e) => e.alias),
);

export function isThermostatCoreAlias(kind: "data" | "order", alias: string): boolean {
  return kind === "data"
    ? THERMOSTAT_CORE_DATA_ALIASES.has(alias)
    : THERMOSTAT_CORE_ORDER_ALIASES.has(alias);
}

/**
 * Identity. A device is a thermostat when it can be given a target
 * temperature: a data point of category `setpoint` or an order of category
 * `set_setpoint` (spec 077). Both are categories a plugin declares, never a
 * vendor key — the Panasonic and MCZ plugins publish them today, and so must
 * anyone else. A sensor or a clamp has no setpoint and is not offered.
 */
export const THERMOSTAT_IDENTITY_DATA_CATEGORY = "setpoint";
export const THERMOSTAT_IDENTITY_ORDER_CATEGORY = "set_setpoint";

/**
 * The operating-mode vocabulary a plugin commits to when it declares the
 * `operation_mode` / `set_operation_mode` categories: the common HVAC set
 * (Home Assistant `hvac_mode`, Zigbee `system_mode`, Panasonic). `off` is
 * optional and never something the core depends on — `power` stays the
 * on/off command; `off` in the mode is a value some units report. A pellet
 * stove has one mode, `heat`; its programme (`profile`) is an extra.
 */
export const OPERATION_MODE_VALUES = ["auto", "heat", "cool", "dry", "fan", "off"] as const;
export type OperationMode = (typeof OPERATION_MODE_VALUES)[number];

export const OPERATION_MODE_DATA_CATEGORY = "operation_mode";
export const OPERATION_MODE_ORDER_CATEGORY = "set_operation_mode";

export function isThermostatDevice(
  data: readonly { category?: string | null }[],
  orders: readonly { category?: string | null }[],
): boolean {
  return (
    data.some((d) => d.category === THERMOSTAT_IDENTITY_DATA_CATEGORY) ||
    orders.some((o) => o.category === THERMOSTAT_IDENTITY_ORDER_CATEGORY)
  );
}

/**
 * The bindings that are NOT the core, each side sorted by alias so a generic
 * renderer is deterministic whatever order the bindings were created in.
 */
export function splitThermostatExtras<D extends { alias: string }, O extends { alias: string }>(
  dataBindings: readonly D[],
  orderBindings: readonly O[],
): { extraData: D[]; extraOrders: O[] } {
  const byAlias = (a: { alias: string }, b: { alias: string }) => a.alias.localeCompare(b.alias);
  return {
    extraData: dataBindings.filter((b) => !THERMOSTAT_CORE_DATA_ALIASES.has(b.alias)).sort(byAlias),
    extraOrders: orderBindings
      .filter((b) => !THERMOSTAT_CORE_ORDER_ALIASES.has(b.alias))
      .sort(byAlias),
  };
}
