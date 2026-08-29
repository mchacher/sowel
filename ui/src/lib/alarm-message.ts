/**
 * Localised text for a banner alarm (#720).
 *
 * The engine emits its alarm messages in English: that is the repo convention,
 * and it is what the logs and the Telegram / ntfy / webhook publishers consume,
 * none of which has a per-user language. The banner is user-facing UI, so it
 * words its own alarms instead of showing the engine's.
 *
 * An alarm the UI knows how to word carries an i18n key and its parameters
 * rather than a pre-translated string. Translating at render rather than at
 * compose time is what makes a language switch re-word the alarms already
 * standing in the banner. `message` stays as the fallback for the alarms the UI
 * has no key for, whose text embeds a raw driver error (order dispatch).
 */
import i18n from "../i18n";
import { dateLocale } from "./locale";
import { localDayToDate } from "./local-date";

/** A local calendar day (`YYYY-MM-DD`), rendered in the viewer's locale. */
export interface DayParam {
  kind: "day";
  day: string;
}

export type AlarmParam = string | number | DayParam;
export type AlarmParams = Record<string, AlarmParam>;

/** Marks a `YYYY-MM-DD` parameter as a date to format, not a string to print. */
export function dayParam(day: string): DayParam {
  return { kind: "day", day };
}

/** The wording side of an alarm: an i18n key when the UI can compose it, the
 *  engine's English text otherwise. */
export interface AlarmWording {
  /** Engine text, English by convention. Absent when `messageKey` is set. */
  message?: string;
  messageKey?: string;
  messageParams?: AlarmParams;
}

function isDayParam(value: AlarmParam): value is DayParam {
  return typeof value === "object" && value !== null && value.kind === "day";
}

/** Resolve the parameters that depend on the locale, at render time. */
function resolveParams(params: AlarmParams): Record<string, string | number> {
  const resolved: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = isDayParam(value)
      ? localDayToDate(value.day).toLocaleDateString(dateLocale(i18n.language), {
          day: "numeric",
          month: "long",
        })
      : value;
  }
  return resolved;
}

/**
 * Text to display for an alarm. `t` is passed in rather than imported so the
 * caller's `useTranslation` subscription drives the re-render on a language
 * switch.
 */
export function alarmText(
  t: (key: string, params?: Record<string, string | number>) => string,
  wording: AlarmWording,
): string {
  if (!wording.messageKey) return wording.message ?? "";
  return t(wording.messageKey, wording.messageParams ? resolveParams(wording.messageParams) : {});
}

/**
 * Stable, language-independent identity of an alarm's wording. Used by the
 * acknowledgement signature: a key alone is not enough, because the parameters
 * carry what makes one alarm different from the next (a battery acknowledged at
 * 12 % has to re-surface when it reaches 5 %).
 */
export function wordingSignature(wording: AlarmWording): string {
  if (!wording.messageKey) return wording.message ?? "";
  const params = wording.messageParams ?? {};
  const keys = Object.keys(params).sort();
  // A key with no parameters signs on the key alone, so an acknowledgement made
  // before the wording moved from text to key survives the upgrade.
  if (keys.length === 0) return wording.messageKey;
  const serialised = keys
    .map((key) => {
      const value = params[key];
      return `${key}=${isDayParam(value) ? value.day : String(value)}`;
    })
    .join(",");
  return `${wording.messageKey}(${serialised})`;
}
