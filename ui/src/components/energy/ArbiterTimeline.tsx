import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ArbiterTimeline as ArbiterTimelineData } from "../../types";
import { getArbiterTimeline } from "../../api";
import { useArbiter } from "../../store/useArbiter";
import { DEFICIT_HUE, SURPLUS_HUE, cellColor, cellEdge, journalDotColor } from "./arbiterColors";
import { journalKindLabel, journalReasonLabel, releasedFrom } from "./arbiterReason";
import { TooltipSeriesRow } from "./TooltipSeriesRow";
import {
  legendStates,
  liveLabelTop,
  mergeRuns,
  sampleInColumn,
  surplusScale,
} from "./arbiter-timeline-geometry";
import { currentLocale, formatPower, formatRange } from "../../lib/format";

// Spec 148 (Phase B) — the redesigned Energy → arbitrage timeline: a signed
// surplus/deficit curve above per-load quarter-hour ribbons, paged back to 48h,
// with the decision journal below linked to a cell click. Colours come from the
// shared energy tokens (production solar family), dark-mode ready.
//
// Spec 197 (FR-E5) — drawn to scale (zero placed from the window's peaks, the
// same W/px both sides), ending on the live reading, read on hover; ribbons
// drawn as runs with one hit target per quarter, keyboard-navigable.

// Window width adapts to the viewport: from a tablet the card carries 12h of
// quarters legibly (spec 197: from 768 px, was 1024), a phone stays at 6h. The
// 48h scroll depth is fixed.
const WINDOW_HOURS_MOBILE = 6;
const WINDOW_HOURS_WIDE = 12;
const DEPTH_HOURS = 48;
const WIDE_QUERY = "(min-width: 768px)";
// The curve's height: 120 px from 1024 px, 88 px below (56 until spec 197,
// too flat to read a morning of import against a noon of surplus).
const DESKTOP_QUERY = "(min-width: 1024px)";
const CURVE_H_DESKTOP = 120;
const CURVE_H_MOBILE = 88;
/** Width of the lane-name column, plus its gap: where the plot starts. */
const PLOT_LEFT_PX = 88;

// Issue #514 — the curve must track the live arbiter state instead of staying
// frozen on the mount snapshot. On the live window we refetch when the arbiter
// emits activity (via useArbiter.timelineRev), throttled: a new curve point only
// lands every ~5 min while status events can fire every few seconds on a
// jittering surplus, so at most one refetch per this window is worthwhile.
const LIVE_REFRESH_THROTTLE_MS = 20_000;

/** A media query's match, SSR- and jsdom-safe, resize-aware. */
function useMatches(query: string): boolean {
  const mq = (): MediaQueryList | null =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;
  const [matches, setMatches] = useState(() => mq()?.matches ?? false);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const onChange = () => setMatches(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mq` reads `query` only
  }, [query]);
  return matches;
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function ArbiterTimeline() {
  const { t } = useTranslation();
  const windowHours = useMatches(WIDE_QUERY) ? WINDOW_HOURS_WIDE : WINDOW_HOURS_MOBILE;
  const isDesktop = useMatches(DESKTOP_QUERY);
  const maxOffset = Math.floor(DEPTH_HOURS / windowHours); // 8 at 6h, 4 at 12h
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ArbiterTimelineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [selTime, setSelTime] = useState<number | null>(null);
  // Spec 197 (FR-E5.3) — the column under the mouse, or under keyboard focus.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  // Spec 197 (FR-E5.7) — the quarter each lane's tab stop sits on (roving
  // tabindex), shared by the lanes so Tab keeps the column.
  const [kbdIdx, setKbdIdx] = useState<number | null>(null);
  const jscrollRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  // The arbiter's live reading, the end of the curve on the live window.
  const liveW = useArbiter((s) => s.state?.availableSurplusW ?? null);
  // When the shown window was loaded: where "now" sits on it. Read in the
  // fetch callbacks, never during render, so a re-render cannot move it.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  // The page the shown data belongs to. `pageOffset` moves on the click, a
  // round trip before the data does: keyed on it, the live point landed on
  // the previous page for that long.
  const [dataOffset, setDataOffset] = useState(0);
  const lastFetchAtRef = useRef(0);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest view params, read from inside the async live refetch to tell whether
  // the view moved (paged / resized) while a fetch was in flight (issue #514 #1).
  const pageOffsetRef = useRef(0);
  const windowHoursRef = useRef(0);
  // The timelineRev the current view was loaded at: the live effect only reacts
  // to *later* arbiter activity, so a mount with an already-nonzero global rev
  // does not schedule a spurious refetch (issue #514 #2).
  const baselineRevRef = useRef(0);

  // Live-refresh signal: bumped once per debounced arbiter burst (issue #514).
  const timelineRev = useArbiter((s) => s.timelineRev);

  // Crossing the breakpoint can shrink maxOffset below the current page —
  // clamp before it reaches the fetch so we never ask past the 48h depth.
  const pageOffset = Math.min(offset, maxOffset);

  // Authoritative load: mount, viewport width change, or paging. Resets the
  // cell selection (the window moved) and clears any queued live refetch.
  useEffect(() => {
    let cancelled = false;
    lastFetchAtRef.current = Date.now();
    pageOffsetRef.current = pageOffset;
    windowHoursRef.current = windowHours;
    // This authoritative load already reflects every arbiter event so far, so
    // rebase the live signal onto the current rev (no immediate live refetch).
    baselineRevRef.current = useArbiter.getState().timelineRev;
    getArbiterTimeline(windowHours, pageOffset, 15)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setDataOffset(pageOffset);
          setLoadedAt(Date.now());
          setFailed(false);
          setSelTime(null);
          setKbdIdx(null);
        }
      })
      .catch(() => {
        // Never throw into the surface; surface a small notice instead of
        // silently vanishing the whole timeline + journal (spec 148 review #5).
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [windowHours, pageOffset]);

  // Live refresh (issue #514): when the arbiter emits activity, refetch the
  // curve + ribbons so they track the badge — but only on the live window
  // (offset 0, never while paging history) and throttled to one refetch per
  // LIVE_REFRESH_THROTTLE_MS. The selection is preserved across a live refetch.
  useEffect(() => {
    // Only react to arbiter activity that landed *after* the current view was
    // loaded, and only on the live window.
    if (pageOffset !== 0 || timelineRev === baselineRevRef.current) return;
    if (liveTimerRef.current) return; // a refetch is already queued for this burst
    const scheduledWindowHours = windowHours;
    const wait = Math.max(0, LIVE_REFRESH_THROTTLE_MS - (Date.now() - lastFetchAtRef.current));
    liveTimerRef.current = setTimeout(() => {
      liveTimerRef.current = null;
      lastFetchAtRef.current = Date.now();
      getArbiterTimeline(scheduledWindowHours, 0, 15)
        .then((d) => {
          // The view may have moved (paged to history, breakpoint crossed) while
          // this refetch was in flight — don't clobber it with live-window data.
          if (pageOffsetRef.current !== 0 || windowHoursRef.current !== scheduledWindowHours) {
            return;
          }
          baselineRevRef.current = useArbiter.getState().timelineRev;
          setData(d);
          setDataOffset(0);
          setLoadedAt(Date.now());
          setFailed(false);
        })
        .catch(() => {
          // Transient error: keep the last good curve rather than blanking it.
        });
    }, wait);
  }, [timelineRev, pageOffset, windowHours]);

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
      <p className="mt-4 text-caption text-text-tertiary">{t("arbiter.timeline.unavailable")}</p>
    );
  if (!data || !geom) return null;
  const { start, stepMs, n } = geom;
  const selIdx = selTime !== null ? Math.round((selTime - start) / stepMs) : -1;

  // ── signed surplus/deficit curve ──────────────────────────────
  // The vertical viewBox maps 1:1 to px, so a bigger H simply gives the
  // surplus/deficit more amplitude.
  const W = 480;
  const H = isDesktop ? CURVE_H_DESKTOP : CURVE_H_MOBILE;
  const span = n * stepMs;
  const samples = data.surplus.map((s) => ({ at: Date.parse(s.atIso), w: s.availableW }));
  // Spec 197 (FR-E5.2, DV-03) — on the live window the curve ends on the
  // arbiter's current reading, the figure the sticker shows, placed at now
  // (the window ends at the end of the quarter under way).
  const now = loadedAt;
  // Clamped to the right edge (a server that still rounds the window end
  // down, before spec 197, ends it up to 15 min before now) and never left of
  // the last sample (`now` is the browser's clock, the samples the server's).
  const lastSampleX = samples.length ? (samples[samples.length - 1].at - start) / span : 0;
  const live =
    dataOffset === 0 && liveW !== null && now >= start
      ? { x: Math.max(lastSampleX, Math.min(1, (now - start) / span)), w: liveW }
      : null;
  // The curve reaches the live dot from its last sample: from below on screen
  // when that sample is lower (less surplus). With no sample, from zero.
  const lastW = samples.length ? samples[samples.length - 1].w : 0;
  const liveFromBelow = live ? lastW < live.w : false;
  const scale = surplusScale(
    samples.map((p) => p.w),
    live?.w ?? null,
    H,
  );
  const { y0, yOf } = scale;
  // SVG coordinates, not text: a tenth of a pixel is plenty.
  const px = (v: number) => Math.round(v * 10) / 10;
  const points = samples.map((p) => ({ x: (p.at - start) / span, w: p.w }));
  if (live) points.push(live);
  const pts = points.map((p) => `${px(p.x * W)},${px(yOf(p.w))}`).join(" ");
  const area = points.length
    ? `${px(points[0].x * W)},${px(y0)} ${pts} ${px(points[points.length - 1].x * W)},${px(y0)}`
    : "";
  // Spec 197 (FR-E5.1) — each half labelled with what its edge stands for.
  const scaleTop = formatPower(scale.topW, { unit: "kW", signed: true });
  const scaleBottom = t("arbiter.timeline.importPeak", {
    power: formatPower(scale.bottomW, { unit: "kW" }),
  });
  // Labels are 11 px tall: the top one spans [0, 11], « 0 » [y0 − 5, y0 + 6],
  // the bottom one [H − 11, H]. « 0 » always shows; an edge label shows only
  // with 4 px to spare, so a half held at its 15 % minimum (a thin, nearly
  // empty half) drops its label rather than crowd « 0 ».
  const LABEL_GAP = 4;
  const showTop = y0 - 5 - 11 >= LABEL_GAP;
  const showBottom = H - 11 - (y0 + 6) >= LABEL_GAP;

  // ── hourly alignment guides ───────────────────────────────────
  // The hour LABELS sit on the clock-hour tick (:00); the dotted GUIDES sit at
  // the CENTRE of each hour column (HH:30), i.e. exactly between two labels — so
  // each guide reads as the middle of its hour slot, distinct from the ticks.
  // Both are 15-min boundaries, so they stay aligned with the runs and the curve.
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

  // ── hover and keyboard (spec 197, FR-E5.3 and FR-E5.7) ────────
  // A mouse gets the crosshair; a finger keeps today's tap-to-select, which
  // scrolls the journal (the readout would sit under the finger anyway).
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const f = (e.clientX - rect.left) / rect.width;
    setHoverIdx(f >= 0 && f < 1 ? Math.floor(f * n) : null);
  };
  const crossIdx = hoverIdx ?? focusIdx;
  const tabIdx = Math.min(kbdIdx ?? n - 1, n - 1);
  const onLaneKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next =
      e.key === "ArrowLeft"
        ? i - 1
        : e.key === "ArrowRight"
          ? i + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const q = Math.max(0, Math.min(n - 1, next));
    setKbdIdx(q);
    e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-q="${q}"]`)?.focus();
  };
  const spoken = (ms: number) => {
    const d = new Date(ms);
    return t("arbiter.timeline.spokenTime", {
      h: d.getHours(),
      m: String(d.getMinutes()).padStart(2, "0"),
    });
  };
  const stateWord = (s: Parameters<typeof cellColor>[0]) =>
    t(`arbiter.loadState.${s}`).toLocaleLowerCase(currentLocale());

  const uid = `arbtl-${pageOffset}`;
  // The live window ends at the end of the quarter under way: say now.
  const rangeEnd = live ? Math.min(geom.end, now) : geom.end;
  const rangeLabel = `${dayLabel(start, t)} · ${formatRange(hhmm(start), hhmm(rangeEnd))}`;
  const legend = legendStates(data.loads);
  const colLeft = (f: number) => `calc(${PLOT_LEFT_PX}px + (100% - ${PLOT_LEFT_PX}px) * ${f})`;

  const tip =
    crossIdx !== null && crossIdx < n
      ? (() => {
          const colStart = start + crossIdx * stepMs;
          // The live column reads the live figure the curve ends on.
          const w =
            live && now >= colStart && now < colStart + stepMs
              ? live.w
              : sampleInColumn(samples, colStart, colStart + stepMs);
          return {
            colStart,
            w,
            lanes: data.loads.filter((l) => l.quarters[crossIdx] !== "idle"),
          };
        })()
      : null;

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-small font-semibold text-text">{t("arbiter.timeline.title")}</h3>
        <span className="ml-auto text-micro text-text-tertiary tabular-nums">{rangeLabel}</span>
        {/* Spec 197 (FR-E5.7) — 24 px buttons, 44 px to a finger. */}
        <div className="flex gap-1 hit-group">
          <button
            onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
            disabled={pageOffset >= maxOffset}
            className="hit-44 w-6 h-6 flex items-center justify-center border border-border rounded-sm text-text-secondary hover:bg-border-light disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label={t("arbiter.timeline.earlier", { h: windowHours })}
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={pageOffset === 0}
            className="hit-44 w-6 h-6 flex items-center justify-center border border-border rounded-sm text-text-secondary hover:bg-border-light disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label={t("arbiter.timeline.later", { h: windowHours })}
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* chart title */}
      <div className="text-micro font-medium text-text-secondary mb-1">
        {t("arbiter.legend.surplusDeficit")}
      </div>

      {/* curve + ribbons, overlaid with thin dotted hourly alignment guides */}
      <div
        className="relative"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <div
          ref={plotRef}
          className="absolute right-0 top-0 bottom-0 pointer-events-none z-20"
          style={{ left: `${PLOT_LEFT_PX}px` }}
        >
          {hourGuides.map((f, k) => (
            <div
              key={k}
              className="absolute top-0 bottom-0"
              style={{
                // -0.5px centres the 1px line on the boundary, i.e. in the
                // middle of the 1px gap where two runs meet there.
                left: `calc(${f * 100}% - 0.5px)`,
                borderLeft:
                  "1px dotted color-mix(in srgb, var(--color-text-tertiary) 40%, transparent)",
              }}
            />
          ))}
          {selIdx >= 0 && selIdx < n && (
            <div
              // #960 — neutral on purpose: the primary token now means "pilotage
              // manuel" on these very cells, so keeping it here made "this
              // column is selected" and "the arbiter stood down here" the same
              // visual signal on the same strip.
              className="absolute top-0 bottom-0 bg-text-secondary/10 border-x border-text-secondary/50"
              style={{
                left: `calc(${(selIdx / n) * 100}% + 1px)`,
                width: `calc(${(1 / n) * 100}% - 2px)`,
              }}
            />
          )}
          {crossIdx !== null && crossIdx < n && (
            <div
              data-testid="arbiter-crosshair"
              className="absolute top-0 bottom-0 border-l border-text-secondary/60"
              style={{ left: `calc(${((crossIdx + 0.5) / n) * 100}% - 0.5px)` }}
            />
          )}
        </div>

        {/* surplus / deficit curve with kW scale */}
        <div className="flex items-stretch gap-2 mt-1 mb-3">
          <div className="relative w-[80px] flex-none">
            {/* leading-none: an 11 px label in the 20 px body line sat 5 px
                below the level it names; each one is now centred on it. */}
            {showTop && (
              <span className="absolute right-0 top-0 text-micro leading-none tabular-nums text-text-tertiary whitespace-nowrap">
                {scaleTop}
              </span>
            )}
            <span
              className="absolute right-0 text-micro leading-none tabular-nums text-text-tertiary"
              style={{ top: `${y0 - 5}px` }}
            >
              0
            </span>
            {showBottom && (
              <span
                className="absolute right-0 text-micro leading-none tabular-nums text-text-tertiary whitespace-nowrap"
                style={{ top: `${H - 11}px` }}
              >
                {scaleBottom}
              </span>
            )}
          </div>
          <div className="relative flex-1 min-w-0">
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
                    fill={SURPLUS_HUE}
                    opacity="0.16"
                    clipPath={`url(#up-${uid})`}
                  />
                  <polygon
                    points={area}
                    fill={DEFICIT_HUE}
                    opacity="0.16"
                    clipPath={`url(#dn-${uid})`}
                  />
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={SURPLUS_HUE}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    clipPath={`url(#up-${uid})`}
                  />
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={DEFICIT_HUE}
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
            {/* Spec 197 (FR-E5.2) — the live end point and its value. HTML,
                not SVG: the plot is stretched (preserveAspectRatio none), which
                would draw a circle as an ellipse. */}
            {live && (
              <>
                <span
                  data-testid="arbiter-live-dot"
                  aria-hidden="true"
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    left: `calc(${live.x * 100}% - 4px)`,
                    top: `${yOf(live.w) - 4}px`,
                    backgroundColor: live.w > 0 ? SURPLUS_HUE : DEFICIT_HUE,
                    boxShadow: "0 0 0 2px var(--color-surface)",
                  }}
                />
                <span
                  data-testid="arbiter-live-value"
                  className="absolute px-1 rounded-xs bg-surface text-caption leading-none tabular-nums text-text whitespace-nowrap"
                  style={{
                    // On a surface pad, ending at the dot, on the side the
                    // curve does not come from; flipped when that side has
                    // no room, and kept inside the plot.
                    right: `calc(${(1 - live.x) * 100}% - 4px)`,
                    top: `${liveLabelTop(yOf(live.w), liveFromBelow, H)}px`,
                  }}
                >
                  {formatPower(Math.abs(live.w))}
                </span>
              </>
            )}
          </div>
        </div>

        {/* per-load ribbons — spec 197 (FR-E5.5): equal neighbours merge into
            one run, drawn under one transparent button per quarter, so a
            duration reads as one bar and every quarter stays selectable. */}
        {data.loads.map((load) => (
          <div key={load.equipmentId} className="flex items-center gap-2 my-[3px]">
            <span
              aria-hidden="true"
              className="w-[80px] flex-none text-right text-micro text-text-secondary truncate"
            >
              {load.name}
            </span>
            <div role="group" aria-label={load.name} className="relative flex-1 h-[20px]">
              {mergeRuns(load.quarters).map((run) => (
                <div
                  key={run.start}
                  data-run={run.state}
                  aria-hidden="true"
                  className="absolute top-1 h-3 rounded-xs pointer-events-none"
                  style={{
                    // A 1 px gap only where two runs meet (they always differ).
                    left: `calc(${(run.start / n) * 100}% + 0.5px)`,
                    width: `calc(${((run.end - run.start) / n) * 100}% - 1px)`,
                    backgroundColor: cellColor(run.state),
                    boxShadow: cellEdge(run.state),
                  }}
                />
              ))}
              {load.quarters.map((s, i) => {
                const cellTime = start + i * stepMs;
                return (
                  <button
                    key={i}
                    type="button"
                    data-q={i}
                    tabIndex={i === tabIdx ? 0 : -1}
                    aria-label={t("arbiter.timeline.cellLabel", {
                      name: load.name,
                      time: spoken(cellTime),
                      state: stateWord(s),
                    })}
                    aria-pressed={i === selIdx}
                    onClick={() => {
                      setKbdIdx(i);
                      onCell(cellTime);
                    }}
                    onKeyDown={(e) => onLaneKey(e, i)}
                    onFocus={() => setFocusIdx(i)}
                    onBlur={() => setFocusIdx(null)}
                    className="absolute top-0 h-[20px] rounded-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-text"
                    style={{
                      left: `${(i / n) * 100}%`,
                      width: `${(1 / n) * 100}%`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Spec 197 (FR-E5.3) — the readout for the column under the mouse
            (or under keyboard focus): its time, its surplus, every lane that
            was doing something. */}
        {tip && (
          <div
            role="presentation"
            className="absolute top-0 z-30 pointer-events-none w-max max-w-[280px] bg-surface border border-border rounded-md p-3 text-caption shadow-lg"
            style={{
              left: colLeft((crossIdx! + 0.5) / n),
              transform: crossIdx! / n > 0.5 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <div className="font-semibold text-text tabular-nums mb-1">{hhmm(tip.colStart)}</div>
            {tip.w !== null && (
              <TooltipSeriesRow
                color={tip.w > 0 ? SURPLUS_HUE : DEFICIT_HUE}
                label={tip.w > 0 ? t("arbiter.aside.available") : t("arbiter.aside.import")}
                value={formatPower(Math.abs(tip.w))}
              />
            )}
            {tip.lanes.map((l) => (
              <TooltipSeriesRow
                key={l.equipmentId}
                color={cellColor(l.quarters[crossIdx!])}
                label={l.name}
                value={t(`arbiter.loadState.${l.quarters[crossIdx!]}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* hour labels — centered on each hourly guide */}
      <div className="relative mt-1 h-[12px]" style={{ marginLeft: `${PLOT_LEFT_PX}px` }}>
        {hourLabels.map((m, k) => (
          <span
            key={k}
            className="absolute top-0 text-micro leading-none text-text-tertiary whitespace-nowrap"
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

      {/* legend — spec 165: one word and one colour per state, the same two the
          roster pill uses. Spec 197 (FR-E5.6): only the states this window
          shows, plus « Au repos »; swatches shaped like the runs. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-text-secondary mt-2 items-center">
        {legend.map((s) => (
          <span key={s} data-legend={s} className="flex items-center gap-1.5">
            <span
              className="w-4 h-3 rounded-xs flex-none"
              style={{ backgroundColor: cellColor(s), boxShadow: cellEdge(s) }}
            />
            {t(`arbiter.loadState.${s}`)}
          </span>
        ))}
      </div>

      {/* journal, linked to the cell click */}
      <div className="mt-3">
        <div className="text-caption font-semibold text-text mb-1">{t("arbiter.journalTitle")}</div>
        <div ref={jscrollRef} className="max-h-[180px] overflow-y-auto">
          {data.journal.length === 0 ? (
            <p className="text-caption text-text-tertiary py-2">
              {t("arbiter.timeline.noDecisions")}
            </p>
          ) : (
            data.journal.map((e, i) => {
              const at = Date.parse(e.atIso);
              const hl = highlighted.has(at);
              const reasonLabel = journalReasonLabel(e.reason, t);
              return (
                <div
                  key={i}
                  data-hl={hl ? "1" : undefined}
                  className={`flex items-baseline gap-2.5 py-1.5 px-1.5 text-caption border-t border-border-light first:border-t-0 rounded-sm ${hl ? "bg-primary/10" : ""}`}
                >
                  <span className="tabular-nums text-micro text-text-tertiary w-11 flex-none">
                    {hhmm(at)}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-none self-center"
                    style={{ backgroundColor: journalDotColor(e.kind) }}
                  />
                  {/* #1129 — the name holds its line (« Chauffe-eau » broke at
                      its hyphen on a phone); the decision gives way, truncated. */}
                  <span className="font-semibold text-text whitespace-nowrap flex-none max-w-[45%] truncate">
                    {e.equipmentName ?? ""}
                  </span>
                  <span className="text-text-secondary truncate min-w-0">
                    {journalKindLabel(
                      e.kind,
                      e.kind === "released"
                        ? releasedFrom(
                            data.journal,
                            i,
                            data.loads.find((l) => l.equipmentId === e.equipmentId),
                            start,
                            stepMs,
                          )
                        : null,
                      t,
                    )}
                    {reasonLabel ? ` · ${reasonLabel}` : ""}
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
