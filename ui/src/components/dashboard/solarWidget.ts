import type { EquipmentWithDetails } from "../../types";
import { resolvePowerReading } from "../../lib/power-reading";

export interface SolarWidgetState {
  producing: boolean;
  lines: string[];
  /**
   * Set when the panel's reading is past its freshness budget, so the surface
   * can say so instead of leaving a silent tile (#839). Null in every other
   * case, "standby" included.
   */
  outdatedSince: string | null;
}

/**
 * Shared presentation state for the solar panel widget so the desktop and mobile
 * dashboards render identically: the produced power, current and voltage under
 * the panel logo, or "Veille" when the panel is not producing (night/offline).
 *
 * Freshness is judged on the group, not on the wattage alone (#839): the three
 * figures come from one inverter, so a stale power reading means stale current
 * and voltage too. Rendering `— · 5.4 A · 231.0 V` would present two figures as
 * live on the strength of a reading we just refused to trust. The whole line
 * goes, and `outdatedSince` tells the surface to explain why — without it a
 * silent tile is indistinguishable from "standby", which means night.
 */
export function solarWidgetState(
  equipment: EquipmentWithDetails,
  t: (key: string) => string,
  now: number = Date.now(),
): SolarWidgetState {
  const num = (category: string): number | null => {
    const b = equipment.dataBindings.find((x) => x.category === category);
    return typeof b?.value === "number" ? b.value : null;
  };

  const powerBinding = equipment.dataBindings.find((x) => x.category === "power");
  const reading = resolvePowerReading(equipment, powerBinding, now);
  const lastKnownW = typeof powerBinding?.value === "number" ? powerBinding.value : null;

  // Standby is asked BEFORE staleness, on the last value rather than on the
  // fresh one. An inverter that has stopped producing has also stopped having
  // anything to say, so at night a panel is silent by design and "outdated"
  // would be the wrong word for eight hours a night. The two cases separate on
  // what the panel was last seen doing: a last reading of zero is a panel that
  // wound down, a positive one that then went quiet is the failure #744 is
  // about. (A panel whose very last frame before sunset was positive reads
  // outdated overnight; the supported integration keeps reporting 0 W through
  // the night, so that edge needs a source that stops mid-production.)
  if (lastKnownW === null || lastKnownW <= 0 || equipment.status === "offline") {
    return { producing: false, lines: [t("solar.standby")], outdatedSince: null };
  }

  if (reading.verdict === "stale") {
    return { producing: false, lines: ["—"], outdatedSince: reading.since };
  }

  const powerW = reading.watts;
  if (powerW === null) {
    return { producing: false, lines: [t("solar.standby")], outdatedSince: null };
  }

  const lines: string[] = [
    powerW >= 1000 ? `${(powerW / 1000).toFixed(2)} kW` : `${Math.round(powerW)} W`,
  ];
  const current = num("current");
  if (current !== null) lines.push(`${current.toFixed(1)} A`);
  const voltage = num("voltage");
  if (voltage !== null) lines.push(`${voltage.toFixed(1)} V`);

  return { producing: true, lines, outdatedSince: null };
}
