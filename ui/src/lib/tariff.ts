import type { TariffConfig } from "../types";

/**
 * Whether a tariff is actually persisted, as opposed to the proposal the form
 * shows before anything is saved (issue #384).
 *
 * `GET /api/v1/settings/energy/tariff` returns an **empty** `schedules` array
 * when `energy.tariff` is absent from settings — that empty array is the "never
 * saved" sentinel. The tariff form pre-fills the standard HP/HC hours as a
 * convenience, so a non-empty local form is not evidence of a saved tariff; the
 * server response is. This helper is the single place that reads that signal, so
 * "displayed" and "saved" can never drift into looking the same again.
 */
export function isTariffSaved(config: TariffConfig): boolean {
  return config.schedules.length > 0;
}
