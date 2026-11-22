/**
 * Issue #1310 — what an order value may look like before it reaches a plugin.
 *
 * Plugins are free to interpret an object value as a whole device payload: the
 * zigbee2mqtt plugin publishes a plain object as-is to `<device>/set`. Ordering
 * an equipment is usage (spec 131, allowlisted for `standard` users), but an
 * arbitrary object would let that user write any device attribute, which is
 * configuration. So, unless the bound order is declared `json`, a value is a
 * primitive, or the one composite kept on purpose: z2m's "on with timed off",
 * `{ <order key>: <primitive>, on_time?, off_wait_time? }`, used by the water
 * valve control and the auto-watering recipe.
 *
 * Range and enum membership are not checked here: an out-of-range or unknown
 * primitive still reaches the device under the order's own key, where the
 * device refuses it, and it grants nothing beyond the order itself.
 */

/** Keys a timed composite may carry besides the order's own key. */
const TIMED_KEYS: ReadonlySet<string> = new Set(["on_time", "off_wait_time"]);

export interface OrderShape {
  /** Device-side order key, e.g. `state`. */
  key: string;
  /** Order DataType as stored: boolean | number | enum | text | json. */
  type: string;
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Returns why `value` may not be sent to these bindings, or null when it may.
 * Every binding of the alias must accept it: the same value is dispatched to
 * each of them.
 */
export function orderValueShapeError(
  bindings: readonly OrderShape[],
  value: unknown,
): string | null {
  if (isPrimitive(value)) return null;
  for (const binding of bindings) {
    if (binding.type === "json") continue;
    if (!isPlainObject(value)) {
      return `Invalid value for order '${binding.key}': expected a ${binding.type} value`;
    }
    const keys = Object.keys(value);
    if (!keys.includes(binding.key) || !isPrimitive(value[binding.key])) {
      return `Invalid value for order '${binding.key}': a timed command needs '${binding.key}'`;
    }
    for (const k of keys) {
      if (k === binding.key) continue;
      if (!TIMED_KEYS.has(k)) {
        return `Invalid value for order '${binding.key}': unexpected field '${k}'`;
      }
      const n = value[k];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        return `Invalid value for order '${binding.key}': '${k}' must be a number of seconds`;
      }
    }
  }
  return null;
}
