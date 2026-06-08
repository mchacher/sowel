import type { EquipmentWithDetails } from "../../types";

/**
 * Shared presentation state for the solar panel widget so the desktop and mobile
 * dashboards render identically: the produced power, current and voltage under
 * the panel logo, or "Veille" when the panel is not producing (night/offline).
 */
export function solarWidgetState(
  equipment: EquipmentWithDetails,
  t: (key: string) => string,
): { producing: boolean; lines: string[] } {
  const num = (category: string): number | null => {
    const b = equipment.dataBindings.find((x) => x.category === category);
    return typeof b?.value === "number" ? b.value : null;
  };

  const powerW = num("power");
  if (powerW === null || powerW <= 0 || equipment.status === "offline") {
    return { producing: false, lines: [t("solar.standby")] };
  }

  const lines: string[] = [
    powerW >= 1000 ? `${(powerW / 1000).toFixed(2)} kW` : `${Math.round(powerW)} W`,
  ];
  const current = num("current");
  if (current !== null) lines.push(`${current.toFixed(1)} A`);
  const voltage = num("voltage");
  if (voltage !== null) lines.push(`${voltage.toFixed(1)} V`);

  return { producing: true, lines };
}
