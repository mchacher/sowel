import type { ArbiterQuarterState } from "../../types";

// Spec 197 (FR-E5) — the pure geometry of the arbiter history: where zero sits
// on the surplus/deficit curve, how quarters merge into runs, which states the
// legend lists. Kept out of the component so each rule is tested without React.

/** Each half of the curve keeps at least this share of the height (FR-E5.1). */
export const MIN_HALF_SHARE = 0.15;

/** Below this span the curve does not stretch a few watts of jitter to the
 *  full height: a 20 W wobble at night stays a flat line near zero. */
export const MIN_SPAN_W = 500;

export interface SurplusScale {
  /** The zero line, in px from the top. */
  y0: number;
  /** Watts per pixel, the same on both sides of zero. */
  wPerPx: number;
  /** What the top edge of the plot stands for, in watts (≥ the surplus peak). */
  topW: number;
  /** What the bottom edge stands for, in watts of import (≥ the deficit peak). */
  bottomW: number;
  yOf: (watts: number) => number;
}

/**
 * Spec 197 (FR-E5.1) — place zero from the window's own peaks:
 * `y0 = H · maxPos / (maxPos + maxNeg)`, so a morning of import does not sit
 * squeezed under a fixed 58 % line while an empty surplus half takes the rest.
 * Both halves share one W/px ratio, so equal watts draw at equal heights on
 * either side. Each half keeps at least 15 % of the height; when that floor
 * applies, the small half's edge stands for a little more than its own peak
 * (`topW`/`bottomW` say how much, and that is what the axis labels show).
 * `live` is the arbiter's current reading, included in the peaks so the end
 * point is never off the scale. `pad` keeps a stroke at a peak inside the box.
 */
export function surplusScale(
  values: number[],
  live: number | null,
  height: number,
  pad = 2,
): SurplusScale {
  const all = live === null ? values : [...values, live];
  const maxPos = Math.max(0, ...all);
  const maxNeg = Math.max(0, ...all.map((v) => -v));
  const inner = height - 2 * pad;
  const total = maxPos + maxNeg;
  const share = Math.min(
    1 - MIN_HALF_SHARE,
    Math.max(MIN_HALF_SHARE, total > 0 ? maxPos / total : 0.5),
  );
  const up = inner * share;
  const down = inner - up;
  const wPerPx = Math.max(maxPos / up, maxNeg / down, MIN_SPAN_W / inner);
  const y0 = pad + up;
  return {
    y0,
    wPerPx,
    topW: up * wPerPx,
    bottomW: down * wPerPx,
    yOf: (w) => y0 - w / wPerPx,
  };
}

export interface Run {
  state: ArbiterQuarterState;
  /** First quarter of the run. */
  start: number;
  /** One past its last quarter. */
  end: number;
}

/**
 * Spec 197 (FR-E5.5) — contiguous quarters in the same state, merged. A night
 * of 40 « Au repos » cells read as 40 events; one bar reads as a duration.
 */
export function mergeRuns(quarters: ArbiterQuarterState[]): Run[] {
  const runs: Run[] = [];
  quarters.forEach((state, i) => {
    const last = runs[runs.length - 1];
    if (last && last.state === state && last.end === i) last.end = i + 1;
    else runs.push({ state, start: i, end: i + 1 });
  });
  return runs;
}

/** The states the ribbon can paint, in reading order (spec 165, #960). */
export const LEGEND_ORDER: ArbiterQuarterState[] = [
  "granted",
  "granted-idle",
  "pending",
  "revoked",
  "unmanaged",
  "suspended",
  "idle",
];

/**
 * Spec 197 (FR-E5.6) — the legend lists the states the window shows, plus
 * « Au repos », which every lane falls back to and which names the pale bar.
 */
export function legendStates(lanes: { quarters: ArbiterQuarterState[] }[]): ArbiterQuarterState[] {
  const present = new Set<ArbiterQuarterState>(["idle"]);
  for (const lane of lanes) for (const s of lane.quarters) present.add(s);
  return LEGEND_ORDER.filter((s) => present.has(s));
}

/**
 * The surplus reading a 15-min column stands for: its last sample, the state
 * it ended in, like a ribbon cell. Null when the column holds none.
 */
export function sampleInColumn(
  samples: { at: number; w: number }[],
  colStart: number,
  colEnd: number,
): number | null {
  let found: number | null = null;
  for (const s of samples) if (s.at >= colStart && s.at < colEnd) found = s.w;
  return found;
}

/** Height of the live value's pad: a 12 px caption line, no vertical padding. */
const LIVE_LABEL_H = 12;
/** Gap between the live dot (r 4 + 2 px ring) and its value. */
const LIVE_LABEL_GAP = 8;

/**
 * Spec 197 — where the live value sits: on the side of the dot the curve does
 * not come from. `preferAbove` is true when the curve reaches the dot from
 * below (the previous point is lower on screen). Flipped when that side has no
 * room, clamped inside the plot.
 */
export function liveLabelTop(dotY: number, preferAbove: boolean, height: number): number {
  const above = dotY - LIVE_LABEL_GAP - LIVE_LABEL_H;
  const below = dotY + LIVE_LABEL_GAP;
  const fitsAbove = above >= 0;
  const fitsBelow = below + LIVE_LABEL_H <= height;
  const top = preferAbove ? (fitsAbove ? above : below) : fitsBelow ? below : above;
  return Math.max(0, Math.min(height - LIVE_LABEL_H, top));
}
