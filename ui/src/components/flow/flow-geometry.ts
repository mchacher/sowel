/**
 * FlowDiagram geometry, types and cadence (spec 157).
 *
 * Split from the component so the .tsx exports a component and nothing else —
 * react-refresh requires it, and it is the same reason `vmcSpeed.ts` sits
 * beside VmcControl (spec 153).
 */

import type { ReactNode } from "react";

/** The three fixed positions a node can occupy. */
export type FlowSlot = "focal" | "left" | "right";

/**
 * A route between two slots. The bottom edge exists in both directions because
 * the two surfaces traverse it opposite ways, and the bubbles must travel the
 * right way round.
 */
export type FlowEdge = "leftToFocal" | "rightToFocal" | "rightToLeft" | "leftToRight";

/**
 * Manhattan routes, verbatim from the v1.53.0 Live page.
 *
 * Box geometry (heights explicit so the centres are deterministic):
 *   focal  top-0            h-[36%] w-[36%] → y   0..130, centre (270,  65)
 *   left   top-1/2 centred  h-[29%] w-[22%] → y 128..232, centre ( 60, 180)
 *   right  top-1/2 centred  h-[29%] w-[22%] → y 128..232, centre (480, 180)
 */
export const PATHS: Record<FlowEdge, string> = {
  leftToFocal: "M 60 180 V 75 Q 60 65 70 65 H 270",
  rightToFocal: "M 480 180 V 75 Q 480 65 470 65 H 270",
  rightToLeft: "M 480 180 V 255 Q 480 270 470 270 H 70 Q 60 270 60 255 V 180",
  leftToRight: "M 60 180 V 255 Q 60 270 70 270 H 470 Q 480 270 480 255 V 180",
};

/** Where an edge's pill sits: mid of the visible vertical leg, or the bottom run. */
export const PILL_POSITION: Record<FlowEdge, string> = {
  leftToFocal: "left-[11%] top-[28%] -translate-x-1/2 -translate-y-1/2",
  rightToFocal: "right-[11%] top-[28%] translate-x-1/2 -translate-y-1/2",
  rightToLeft: "left-1/2 top-[75%] -translate-x-1/2 -translate-y-1/2",
  leftToRight: "left-1/2 top-[75%] -translate-x-1/2 -translate-y-1/2",
};

export const SLOT_BOX: Record<FlowSlot, string> = {
  focal: "top-0 left-1/2 -translate-x-1/2 w-[36%] h-[36%] px-3 py-2",
  left: "top-1/2 -translate-y-1/2 left-0 w-[22%] h-[29%] px-2 py-2",
  right: "top-1/2 -translate-y-1/2 right-0 w-[22%] h-[29%] px-2 py-2",
};

export const SLOT_VALUE: Record<FlowSlot, string> = {
  focal: "text-[20px] sm:text-[24px] mt-1",
  left: "text-[16px] sm:text-[19px]",
  right: "text-[16px] sm:text-[19px]",
};

export interface FlowNodeSpec {
  slot: FlowSlot;
  label: string;
  /** Fully styled icon — callers size it (w-11 sm:w-14 focal, w-9 sm:w-10 satellites). */
  icon: ReactNode;
  /** Pre-formatted value; the diagram never formats. */
  value: string;
  unit?: string;
  /** Optional second line under the value (the UPS reads its autonomy here). */
  sub?: string;
  /** Glyph before the value — the grid node's ↑ / ↓ direction arrow. */
  valuePrefix?: ReactNode;
  color: string;
  /**
   * Idle. The box itself stays fully opaque on purpose: the skeleton routes
   * start at its centre, so a translucent box would let the grey line show
   * through the icon. Only the contents dim.
   */
  dimmed?: boolean;
}

export interface FlowLinkSpec {
  edge: FlowEdge;
  color: string;
  /** False → the route is drawn as skeleton only, with no overlay and no bubbles. */
  active: boolean;
  /**
   * Drives the bubble cadence, log-scaled so the flow stays calm. Omit for a
   * link with no meaningful magnitude (a UPS charging loop) — it then uses the
   * mid-range cadence.
   */
  magnitude?: number;
  pill?: { text: string; color: string };
}

export interface FlowDiagramProps {
  nodes: FlowNodeSpec[];
  links: FlowLinkSpec[];
  /** Qualitative one-word summary, in the empty band under the diagram. */
  tag?: { text: string; color: string };
  /** Sentence describing the whole flow for screen readers. */
  ariaLabel?: string;
}

export const DEFAULT_DURATION = 5.5;

/**
 * Bubble travel time in seconds, inversely log-scaled with magnitude. Stays
 * between 4 s and 7 s so a big flow never zooms and a small one never stalls.
 */
export function flowDuration(magnitude: number | undefined): number {
  if (magnitude === undefined) return DEFAULT_DURATION;
  const a = Math.abs(magnitude);
  if (a < 5) return 0;
  const d = 7 - Math.log10(a + 10) * 0.6;
  return Math.max(4, Math.min(7, d));
}

