import { energyShares } from "./evSessionsDisplay";

/** Off-peak / peak / solar bar (variant B agreed with the maintainer). */
export function ShareBar({
  e,
  height,
  label,
}: {
  e: { gridHcWh: number; gridHpWh: number; solarWh: number };
  height: string;
  label?: string;
}) {
  const s = energyShares(e);
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`flex ${height} rounded-full overflow-hidden bg-border-light gap-[2px]`}
    >
      {s.hc > 0 && <div className="bg-energy-hc" style={{ width: `${s.hc}%` }} />}
      {s.hp > 0 && <div className="bg-energy-hp" style={{ width: `${s.hp}%` }} />}
      {s.solar > 0 && <div className="bg-solar-auto" style={{ width: `${s.solar}%` }} />}
    </div>
  );
}
