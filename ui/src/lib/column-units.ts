// #1231 — the unit symbols that mix cases, which an `uppercase` header breaks
// (an all-capital one like W or V it cannot change). Standing alone, not the
// « Wh » of « What », with a « €/ » before or a « /an » after kept with them.
const UNIT =
  /(?<!\p{L})((?:€\/)?(?:kWh|kWc|kVA|kW|Wh|Wc|hPa|Hz|mA|ms|min|°C)(?:\/\p{L}+)?)(?!\p{L})/u;

/** True when `text` holds a unit symbol whose case an `uppercase` header would break. */
export function hasUnit(text: string): boolean {
  return UNIT.test(text);
}

/** `text` cut around its unit symbols: the units sit at the odd indexes. */
export function splitUnits(text: string): string[] {
  return text.split(new RegExp(UNIT.source, "gu"));
}
