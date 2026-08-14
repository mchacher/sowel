import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ArbiterQuarterState, ArbiterTimeline as ArbiterTimelineData } from "../../types";
import { getArbiterTimeline } from "../../api";
import { journalDotColor } from "./arbiterColors";

// Spec 148 (Phase B) — the redesigned Energy → arbitrage timeline: a signed
// surplus/deficit curve above per-load quarter-hour ribbons, paged back to 48h,
// with the decision journal below linked to a cell click. Colours come from the
// shared energy tokens (production solar family), dark-mode ready.

// Window width adapts to the viewport: a wider desktop card can carry 12h of
// quarter cells legibly, a phone stays at 6h. The 48h scroll depth is fixed.
const WINDOW_HOURS_MOBILE = 6;
const WINDOW_HOURS_DESKTOP = 12;
const DEPTH_HOURS = 48;
const DESKTOP_QUERY = "(min-width: 1024px)";

/** Live 6h/12h window width from the viewport (SSR- and jsdom-safe, resize-aware). */
function useWindowHours(): number {
  const desktopMq = (): MediaQueryList | null =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_QUERY)
      : null;
  const [hours, setHours] = useState(() =>
    desktopMq()?.matches ? WINDOW_HOURS_DESKTOP : WINDOW_HOURS_MOBILE,
  );
  useEffect(() => {
    const mq = desktopMq();
    if (!mq) return;
    const onChange = () => setHours(mq.matches ? WINDOW_HOURS_DESKTOP : WINDOW_HOURS_MOBILE);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return hours;
}

function cellColor(s: ArbiterQuarterState): string {
  switch (s) {
    case "granted":
      return "var(--color-solar-auto)"; // accordé (auto-conso)
    case "revoked":
      return "var(--color-error)"; // surplus retiré
    case "unmanaged":
      return "var(--color-slate)"; // On (hors pilotage)
    default:
      return "color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)"; // idle
  }
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ArbiterTimeline() {
  const { t } = useTranslation();
  const windowHours = useWindowHours();
  const maxOffset = Math.floor(DEPTH_HOURS / windowHours); // 8 at 6h, 4 at 12h
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ArbiterTimelineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [selTime, setSelTime] = useState<number | null>(null);
  const jscrollRef = useRef<HTMLDivElement>(null);

  // Crossing the breakpoint can shrink maxOffset below the current page —
  // clamp before it reaches the fetch so we never ask past the 48h depth.
  const pageOffset = Math.min(offset, maxOffset);

  useEffect(() => {
    let cancelled = false;
    getArbiterTimeline(windowHours, pageOffset, 15)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setFailed(false);
          setSelTime(null);
        }
      })
      .catch(() => {
        // Never throw into the surface; surface a small notice instead of
        // silently vanishing the whole timeline + journal (spec 148 review #5).
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [windowHours, pageOffset]);

  const geom = useMemo(() => {
    if (!data) return null;
    const start = Date.parse(data.windowStartIso);
    const end = Date.parse(data.windowEndIso);
    const stepMs = data.stepMin * 60_000;
    const n = data.loads[0]?.quarters.length ?? Math.max(0, Math.round((end - start) / stepMs));
    return { start, end, stepMs, n };
  }, [data]);

  if (failed && !data)
    return (
      <p className="mt-4 text-[12px] text-text-tertiary">{t("arbiter.timeline.unavailable")}</p>
    );
  if (!data || !geom) return null;
  const { start, stepMs, n } = geom;
  const selIdx = selTime !== null ? Math.round((selTime - start) / stepMs) : -1;

  // ── signed surplus/deficit curve ──────────────────────────────
  // The desktop card has room for a taller curve (2×): the vertical viewBox maps
  // 1:1 to px, so a bigger H simply gives the surplus/deficit more amplitude.
  const isDesktop = windowHours === WINDOW_HOURS_DESKTOP;
  const W = 480;
  const H = isDesktop ? 120 : 56;
  const values = data.surplus.map((s) => ({
    x: (Date.parse(s.atIso) - start) / (n * stepMs),
    v: s.availableW,
  }));
  const maxAbs = Math.max(500, ...data.surplus.map((s) => Math.abs(s.availableW)));
  const y0 = Math.round(H * 0.58);
  const yUp = y0; // px available above baseline
  const yDown = H - y0; // px below
  const yOf = (v: number) =>
    v >= 0 ? y0 - (v / maxAbs) * (yUp - 2) : y0 + (-v / maxAbs) * (yDown - 2);
  const pts = values.map((p) => `${(p.x * W).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
  const area = values.length ? `0,${y0} ${pts} ${W},${y0}` : "";
  const scaleKW = (maxAbs / 1000).toFixed(1); // symmetric axis: +/- the same peak

  // ── hourly alignment guides ───────────────────────────────────
  // The hour LABELS sit on the clock-hour tick (:00); the dotted GUIDES sit at
  // the CENTRE of each hour column (HH:30), i.e. exactly between two labels — so
  // each guide reads as the middle of its hour slot, distinct from the ticks.
  // Both are 15-min cell boundaries, so they stay pixel-aligned with the ribbon
  // cells and the curve.
  const hourLabels: { f: number; label: string }[] = [];
  const hourGuides: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const tm = new Date(start + i * stepMs);
    if (tm.getMinutes() === 0) hourLabels.push({ f: i / n, label: `${tm.getHours()}h` });
    else if (tm.getMinutes() === 30) hourGuides.push(i / n);
  }

  // ── journal linkage ───────────────────────────────────────────
  const highlighted = new Set<number>();
  if (selTime !== null) {
    data.journal.forEach((e) => {
      const at = Date.parse(e.atIso);
      if (at >= selTime && at < selTime + stepMs) highlighted.add(at);
    });
  }
  const onCell = (cellTime: number) => {
    setSelTime(cellTime);
    // scroll the first matching journal row into view
    requestAnimationFrame(() => {
      const el = jscrollRef.current?.querySelector<HTMLElement>("[data-hl='1']");
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const uid = `arbtl-${pageOffset}`;
  const rangeLabel = `${dayLabel(start, t)} · ${hhmm(start)}-${hhmm(geom.end)}`;

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-[13px] font-semibold text-text">{t("arbiter.timeline.title")}</h3>
        <span className="ml-auto text-[11px] text-text-tertiary font-mono">{rangeLabel}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
            disabled={pageOffset >= maxOffset}
            className="w-6 h-6 flex items-center justify-center border border-border rounded-[6px] text-text-secondary hover:bg-border-light disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label={t("arbiter.timeline.earlier", { h: windowHours })}
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={pageOffset === 0}
            className="w-6 h-6 flex items-center justify-center border border-border rounded-[6px] text-text-secondary hover:bg-border-light disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label={t("arbiter.timeline.later", { h: windowHours })}
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* chart title */}
      <div className="text-[11px] font-medium text-text-secondary mb-1">
        {t("arbiter.legend.surplusDeficit")}
      </div>

      {/* curve + ribbons, overlaid with thin dotted hourly alignment guides */}
      <div className="relative">
        <div className="absolute left-[88px] right-0 top-0 bottom-0 pointer-events-none z-20">
          {hourGuides.map((f, k) => (
            <div
              key={k}
              className="absolute top-0 bottom-0"
              style={{
                // -0.5px centres the 1px line on the boundary, i.e. in the
                // middle of the 2px gap between the two cells that meet there.
                left: `calc(${f * 100}% - 0.5px)`,
                borderLeft:
                  "1px dotted color-mix(in srgb, var(--color-text-tertiary) 40%, transparent)",
              }}
            />
          ))}
          {selIdx >= 0 && selIdx < n && (
            <div
              className="absolute top-0 bottom-0 bg-primary/15 border-x border-primary/40"
              style={{
                left: `calc(${(selIdx / n) * 100}% + 1px)`,
                width: `calc(${(1 / n) * 100}% - 2px)`,
              }}
            />
          )}
        </div>

        {/* surplus / deficit curve with kW scale */}
        <div className="flex items-stretch gap-2 mt-1 mb-3">
          <div className="relative w-[80px] flex-none">
            <span className="absolute right-0 top-[2px] text-[8px] font-mono text-text-tertiary">
              +{scaleKW} kW
            </span>
            <span
              className="absolute right-0 text-[8px] font-mono text-text-tertiary"
              style={{ top: `${y0 - 4}px` }}
            >
              0
            </span>
            <span
              className="absolute right-0 text-[8px] font-mono text-text-tertiary"
              style={{ top: `${H - 10}px` }}
            >
              -{scaleKW} kW
            </span>
          </div>
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ display: "block", height: `${H}px` }}
          >
            <defs>
              <clipPath id={`up-${uid}`}>
                <rect x="0" y="0" width={W} height={y0} />
              </clipPath>
              <clipPath id={`dn-${uid}`}>
                <rect x="0" y={y0} width={W} height={H - y0} />
              </clipPath>
            </defs>
            {area && (
              <>
                <polygon
                  points={area}
                  fill="var(--color-solar-injection)"
                  opacity="0.16"
                  clipPath={`url(#up-${uid})`}
                />
                <polygon
                  points={area}
                  fill="var(--color-error)"
                  opacity="0.16"
                  clipPath={`url(#dn-${uid})`}
                />
                <polyline
                  points={pts}
                  fill="none"
                  stroke="var(--color-solar-injection)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  clipPath={`url(#up-${uid})`}
                />
                <polyline
                  points={pts}
                  fill="none"
                  stroke="var(--color-error)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  clipPath={`url(#dn-${uid})`}
                />
              </>
            )}
            <line
              x1="0"
              y1={y0}
              x2={W}
              y2={y0}
              stroke="var(--color-text-tertiary)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              opacity="0.6"
            />
          </svg>
        </div>

        {/* per-load ribbons */}
        {data.loads.map((load) => (
          <div key={load.equipmentId} className="flex items-center gap-2 my-[3px]">
            <span className="w-[80px] flex-none text-right text-[10px] text-text-secondary truncate">
              {load.name}
            </span>
            {/* Cells positioned by exact percentage (not flexbox) so a boundary
                lands precisely at i/n — the SAME basis as the guides — with a 2px
                gap centred on each boundary, so a guide passes through its middle. */}
            <div className="relative flex-1 h-[20px]">
              {load.quarters.map((s, i) => {
                const cellTime = start + i * stepMs;
                return (
                  <button
                    key={i}
                    onClick={() => onCell(cellTime)}
                    title={`${hhmm(cellTime)} · ${t(`arbiter.timeline.state.${s}`)}`}
                    className="absolute top-0 h-[20px] rounded-[1px] focus:outline-none"
                    style={{
                      left: `calc(${(i / n) * 100}% + 1px)`,
                      width: `calc(${(1 / n) * 100}% - 2px)`,
                      backgroundColor: cellColor(s),
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* hour labels — centered on each hourly guide */}
      <div className="relative ml-[88px] mt-1 h-[12px]">
        {hourLabels.map((m, k) => (
          <span
            key={k}
            className="absolute top-0 text-[9px] text-text-tertiary whitespace-nowrap"
            style={{
              left: `${m.f * 100}%`,
              transform:
                m.f <= 0.02
                  ? "translateX(0)"
                  : m.f >= 0.98
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary mt-2 items-center">
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-2.5 rounded-sm flex-none"
            style={{ backgroundColor: "var(--color-solar-auto)" }}
          />
          {t("arbiter.legend.granted")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-2.5 rounded-sm flex-none"
            style={{ backgroundColor: "var(--color-error)" }}
          />
          {t("arbiter.legend.revoked")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-2.5 rounded-sm flex-none"
            style={{ backgroundColor: "var(--color-slate)" }}
          />
          {t("arbiter.legend.unmanaged")}
        </span>
      </div>

      {/* journal, linked to the cell click */}
      <div className="mt-3">
        <div className="text-[12px] font-semibold text-text mb-1">{t("arbiter.journalTitle")}</div>
        <div ref={jscrollRef} className="max-h-[180px] overflow-y-auto">
          {data.journal.length === 0 ? (
            <p className="text-[12px] text-text-tertiary py-2">
              {t("arbiter.timeline.noDecisions")}
            </p>
          ) : (
            data.journal.map((e, i) => {
              const at = Date.parse(e.atIso);
              const hl = highlighted.has(at);
              return (
                <div
                  key={i}
                  data-hl={hl ? "1" : undefined}
                  className={`flex items-baseline gap-2.5 py-1.5 px-1.5 text-[12.5px] border-t border-border-light first:border-t-0 rounded-[4px] ${hl ? "bg-primary/10" : ""}`}
                >
                  <span className="font-mono text-[11px] text-text-tertiary w-11 flex-none">
                    {hhmm(at)}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-none self-center"
                    style={{ backgroundColor: journalDotColor(e.kind) }}
                  />
                  <span className="font-semibold text-text">{e.equipmentName ?? ""}</span>
                  <span className="text-text-secondary truncate">
                    {t(`arbiter.kind.${e.kind}`)}
                    {e.reason ? ` · ${e.reason}` : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function dayLabel(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.floor((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86_400_000);
  if (diff <= 0) return t("arbiter.timeline.today");
  if (diff === 1) return t("arbiter.timeline.yesterday");
  return t("arbiter.timeline.daysAgo", { n: diff });
}
