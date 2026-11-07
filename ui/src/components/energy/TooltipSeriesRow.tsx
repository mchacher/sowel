/**
 * One series in an energy chart tooltip: a swatch in the series colour, then
 * the label and the value in neutral text (#1126).
 *
 * The rows used to be written in the series colour itself. The energy palette
 * is tuned to tell bars apart, not to be read as text: the off-peak blue was
 * 2.08:1 on a light card, peak 4.35:1 and injection 3.75:1 on a dark one.
 * Same shape as the by-usage tooltip, which already worked this way.
 */
export function TooltipSeriesRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-text-secondary">
      <span
        aria-hidden
        data-testid="tooltip-swatch"
        className="inline-block w-2.5 h-2.5 rounded-xs flex-none"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
      <span className="ml-auto pl-3 tabular-nums text-text">{value}</span>
    </div>
  );
}
