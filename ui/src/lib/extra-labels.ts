import type { TFunction } from "i18next";
import { humanizeAlias } from "./humanize-alias";

/**
 * Labels for the data a plugin publishes beyond an equipment's contract (spec 196, FR-2):
 * the Tuya charger's `maxCurrent`, `plugInAction`, `status`… used to show as
 * « Max current », « sleep ». The dictionary is keyed in snake_case, so a plugin that
 * names its key `maxCurrent` and one that names it `max_current` read the same label.
 * Anything the dictionary does not cover keeps the humanised alias and the raw value.
 */
function dictionaryKey(alias: string): string {
  return alias.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** `namespace` is the equipment's i18n prefix, e.g. `equipments.evCharger`. */
export function extraLabel(namespace: string, alias: string, t: TFunction): string {
  return t(`${namespace}.extras.${dictionaryKey(alias)}`, { defaultValue: humanizeAlias(alias) });
}

/** A text value (an enum state such as `sleep`) in words, or as published when unknown. */
export function extraTextValue(
  namespace: string,
  alias: string,
  value: string,
  t: TFunction,
): string {
  return t(`${namespace}.values.${dictionaryKey(alias)}.${value}`, { defaultValue: value });
}
