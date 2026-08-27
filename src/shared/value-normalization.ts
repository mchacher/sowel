import type { DataType } from "./types.js";

/**
 * Result of normalizing an incoming device value against its declared type.
 * `flagged` means the value could not be coerced: the raw value is kept and
 * the caller should log a (deduplicated) warning.
 */
export interface NormalizationResult {
  value: unknown;
  flagged: boolean;
}

const BOOLEAN_TRUE = new Set(["on", "true", "1"]);
const BOOLEAN_FALSE = new Set(["off", "false", "0"]);

/**
 * Single value-coercion authority (spec 150).
 *
 * Integration plugins declare each data point's type at discovery and forward
 * runtime values raw; the core calls this once at ingestion so that everything
 * downstream (UI, zones, gate derivation, recipes, history) receives a stable
 * JS type. Polarity-ambiguous vocabularies (OPEN/CLOSED, DETECTED, ...) are
 * deliberately NOT coerced: a wrong polarity guess is worse than a visible
 * warning, so they come back flagged with the raw value preserved.
 *
 * An integration can lift that ambiguity by declaring the pair itself:
 * `valueOn` / `valueOff` are the literals the device uses on the wire, and
 * when both are given they take precedence over the vocabulary below. Nothing
 * is guessed then — the device said which literal means on — so an exotic
 * vocabulary such as LOCK/UNLOCK resolves without widening the hard-coded
 * list, which cannot be exhaustive. This is the inbound mirror of
 * `resolveWireValue`, which maps booleans onto the same pair when dispatching
 * an order.
 */
export function normalizeValue(
  value: unknown,
  type: DataType,
  enumValues?: string[] | null,
  valueOn?: unknown,
  valueOff?: unknown,
): NormalizationResult {
  // Availability/absence is handled elsewhere — never touch null/undefined.
  if (value === null || value === undefined) return { value, flagged: false };

  switch (type) {
    case "boolean":
      return normalizeBoolean(value, valueOn, valueOff);
    case "number":
      return normalizeNumber(value);
    case "enum":
      return normalizeEnum(value, enumValues);
    case "text":
      return normalizeText(value);
    case "json":
      return { value, flagged: false };
    default:
      // Plugins are runtime JS: a community plugin can declare a type outside
      // the DataType union (e.g. "string", "binary"). Unknown type → tolerant
      // pass-through, matching getDeviceDataValue's default.
      return { value, flagged: false };
  }
}

const ON_OFF_ENUM_TOKENS = new Set(["on", "off", "toggle"]);

/**
 * True when a declared (type, enumValues) contradicts the canonical type
 * expected for its category (spec 150 F4). An ON/OFF(/TOGGLE) enum is a
 * legitimate historical representation of a boolean-expected category
 * (e.g. Tasmota relay power states) and is not a mismatch.
 */
export function isCategoryTypeMismatch(
  expectedType: DataType,
  declaredType: DataType,
  enumValues?: string[] | null,
): boolean {
  if (declaredType === expectedType) return false;
  if (
    expectedType === "boolean" &&
    declaredType === "enum" &&
    enumValues !== undefined &&
    enumValues !== null &&
    enumValues.length > 0 &&
    enumValues.every((e) => ON_OFF_ENUM_TOKENS.has(e.toLowerCase()))
  ) {
    return false;
  }
  return true;
}

function normalizeBoolean(
  value: unknown,
  valueOn?: unknown,
  valueOff?: unknown,
): NormalizationResult {
  if (typeof value === "boolean") return { value, flagged: false };

  // Declared wire pair wins over the hard-coded vocabulary below. The device
  // states which literal means on and which means off, so there is nothing to
  // guess — that is what makes LOCK/UNLOCK, and any future vocabulary,
  // resolvable without widening the polarity-ambiguous list.
  if (valueOn !== undefined && valueOff !== undefined) {
    if (value === valueOn) return { value: true, flagged: false };
    if (value === valueOff) return { value: false, flagged: false };
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (typeof valueOn === "string" && lowered === valueOn.toLowerCase()) {
        return { value: true, flagged: false };
      }
      if (typeof valueOff === "string" && lowered === valueOff.toLowerCase()) {
        return { value: false, flagged: false };
      }
    }
  }

  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (BOOLEAN_TRUE.has(lowered)) return { value: true, flagged: false };
    if (BOOLEAN_FALSE.has(lowered)) return { value: false, flagged: false };
    return { value, flagged: true };
  }
  if (value === 1) return { value: true, flagged: false };
  if (value === 0) return { value: false, flagged: false };
  return { value, flagged: true };
}

function normalizeNumber(value: unknown): NormalizationResult {
  if (typeof value === "number") {
    return { value, flagged: !Number.isFinite(value) };
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return { value: parsed, flagged: false };
  }
  return { value, flagged: true };
}

function normalizeEnum(value: unknown, enumValues?: string[] | null): NormalizationResult {
  if (typeof value !== "string") return { value, flagged: true };
  if (!enumValues || enumValues.length === 0) return { value, flagged: false };
  const lowered = value.trim().toLowerCase();
  const canonical = enumValues.find((e) => e.toLowerCase() === lowered);
  if (canonical !== undefined) return { value: canonical, flagged: false };
  return { value, flagged: true };
}

function normalizeText(value: unknown): NormalizationResult {
  if (typeof value === "string") return { value, flagged: false };
  if (typeof value === "number" || typeof value === "boolean") {
    return { value: String(value), flagged: false };
  }
  return { value, flagged: true };
}
