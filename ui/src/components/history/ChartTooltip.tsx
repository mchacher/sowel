import { useTranslation } from "react-i18next";
import { formatTooltipRow, type TooltipRow, type TooltipSeries } from "./tooltip-format";

interface PayloadEntry {
  name?: string | number;
  value?: number | string | number[];
  payload?: Record<string, number>;
}

interface ChartTooltipProps {
  /** Injected by Recharts. */
  active?: boolean;
  /** Injected by Recharts — one entry per rendered series at the hovered point. */
  payload?: PayloadEntry[];
  /** All plotted series, resolved with their colour. */
  series: TooltipSeries[];
}

function formatHeaderTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Point-detail tooltip for the Analyse chart (#498, point 4).
 *
 * A compact card capped at `min(280px, 88vw)` with wrapping labels, so the long
 * "Zone / Equipment / Metric" lines never blow past the viewport on mobile
 * (the previous default Recharts tooltip had no width bound). One row per
 * series: colour dot, label, formatted value.
 */
export function ChartTooltip({ active, payload, series }: ChartTooltipProps) {
  const { t } = useTranslation();
  if (!active || !payload || payload.length === 0) return null;

  const ts = payload[0]?.payload?.time;
  const header = typeof ts === "number" ? formatHeaderTime(ts) : "";

  const byId = new Map(series.map((s) => [s.id, s]));
  const rows: TooltipRow[] = [];
  const seen = new Set<string>();
  for (const p of payload) {
    const id = typeof p.name === "string" ? p.name : "";
    // Envelope band / min / max entries carry an "id:band" name that matches no
    // series id, so they are skipped; the band shows inline on the mean row.
    const s = byId.get(id);
    if (!s || seen.has(id)) continue;
    seen.add(id);
    const row = formatTooltipRow(s, Array.isArray(p.value) ? undefined : p.value, p.payload, t);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return null;

  return (
    <div className="max-w-[min(280px,88vw)] rounded-[6px] border border-border bg-surface px-3 py-2 text-[12px] text-text shadow-md">
      {header && <div className="mb-1.5 font-medium text-text-secondary">{header}</div>}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-1.5 leading-snug">
            <span
              className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: r.color }}
            />
            <span className="min-w-0 break-words">
              <span className="text-text-secondary">{r.label}</span>{" "}
              <span className="font-medium text-text">{r.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
