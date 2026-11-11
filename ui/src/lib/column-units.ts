// #1231 — the unit symbols a column header can carry, standing alone (not
// the « Wh » of « What »). Longest first, so « €/kWh » wins over « kWh ».
const UNIT = /(?<!\p{L})(€\/kWh|kWh|Wh|kW|kVA|°C|W|V|A)(?!\p{L})/u;

/** True when `text` holds a unit symbol whose case an `uppercase` header would break. */
export function hasUnit(text: string): boolean {
  return UNIT.test(text);
}

/** `text` cut around its unit symbols: the units sit at the odd indexes. */
export function splitUnits(text: string): string[] {
  return text.split(new RegExp(UNIT.source, "gu"));
}
