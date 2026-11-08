/**
 * FlowDiagram geometry, types and cadence (spec 157, reworked by spec 197).
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
 * the two surfaces traverse it opposite ways, and the wave must travel the
 * right way round.
 */
export type FlowEdge = "leftToFocal" | "rightToFocal" | "rightToLeft" | "leftToRight";

/**
 * The viewBox is 540 × 290 (spec 197). It was 540 × 360 while a status tag
 * sat in a band under the bottom route; the headline above the diagram
 * replaced the tag.
 *
 * The routes run between the node centres and pass under the nodes, which are
 * the card's colour and mask them:
 *   focal  (270,  65)   the icon's centre: the top routes arrive at its height
 *   left   ( 60, 180)
 *   right  (480, 180)
 *
 * The narrow and wide sizes switch on the diagram's own width, a container
 * query at 32 rem (`@lg:`), not on the screen's: from `lg` the Live diagram
 * sits in a 7/12 column, 360 px wide at 1024 px with the sidebar open.
 */
export const VIEWBOX_HEIGHT = 290;

export const PATHS: Record<FlowEdge, string> = {
  leftToFocal: "M 60 180 V 75 Q 60 65 70 65 H 270",
  rightToFocal: "M 480 180 V 75 Q 480 65 470 65 H 270",
  rightToLeft: "M 480 180 V 255 Q 480 270 470 270 H 70 Q 60 270 60 255 V 180",
  leftToRight: "M 60 180 V 255 Q 60 270 70 270 H 470 Q 480 270 480 255 V 180",
};

/** Where each node's icon centre sits, in % of the diagram (x of 540, y of 290). */
export const SLOT_ANCHOR: Record<FlowSlot, { left: number; top: number }> = {
  focal: { left: 50, top: (65 / VIEWBOX_HEIGHT) * 100 },
  left: { left: (60 / 540) * 100, top: (180 / VIEWBOX_HEIGHT) * 100 },
  right: { left: (480 / 540) * 100, top: (180 / VIEWBOX_HEIGHT) * 100 },
};

/**
 * The icon row of a node. The focal row is as wide as the gap the top routes
 * leave on each side of the house (the design's 2 × 50 px narrow, 2 × 64 px
 * wide), so the arrowheads land at a fixed distance from the icon whatever
 * the label; a satellite's row is its icon with a little air.
 */
export const SLOT_ICON_ROW: Record<FlowSlot, string> = {
  focal: "w-[100px] @lg:w-[128px]",
  left: "px-1",
  right: "px-1",
};

export const SLOT_LABEL: Record<FlowSlot, string> = {
  focal: "text-caption @lg:text-small",
  left: "text-micro @lg:text-small",
  right: "text-micro @lg:text-small",
};

export const SLOT_VALUE: Record<FlowSlot, string> = {
  focal: "text-title @lg:text-display gap-1",
  left: "text-body @lg:text-title gap-0.5 @lg:gap-1",
  right: "text-body @lg:text-title gap-0.5 @lg:gap-1",
};

/** Width of a node's share bar: 76 / 96 px under the focal value, 58 / 72 px under a satellite's. */
export const SLOT_BAR: Record<FlowSlot, string> = {
  focal: "w-[76px] @lg:w-[96px]",
  left: "w-[58px] @lg:w-[72px]",
  right: "w-[58px] @lg:w-[72px]",
};

/**
 * Spec 197 (FR-E7) — the share bar under a node's value: the parts the node
 * receives or gives, in route order (grid then solar into the house; the house
 * then the grid out of the panel), each in its route's colour, with its
 * pre-formatted percentage. A single part under 1 is a level (a UPS load, a
 * battery charge): the track shows the rest, and no figure is repeated.
 */
export interface FlowShareBar {
  parts: { share: number; color: string; label?: string }[];
}

export interface FlowNodeSpec {
  slot: FlowSlot;
  label: string;
  /** Fully styled icon — callers size it (w-11 @lg:w-14 focal, w-9 @lg:w-10 satellites). */
  icon: ReactNode;
  /** Pre-formatted value; the diagram never formats. */
  value: string;
  unit?: string;
  /** Optional second line under the value (« import », « en décharge »). */
  sub?: string;
  /** Paints the icon only; the value is always in ink (#1126). */
  color: string;
  /** The share bar under the value; omit for a node with nothing to split. */
  bar?: FlowShareBar;
  /**
   * Idle. Only the contents dim: the boxes stay opaque, since they mask the
   * routes that start under them.
   */
  dimmed?: boolean;
}

export interface FlowLinkSpec {
  edge: FlowEdge;
  color: string;
  /** False → the route is drawn as skeleton only, with no ribbon and no wave. */
  active: boolean;
  /**
   * Absolute watts on the route (spec 197): the ribbon's width and the wave's
   * speed follow it. Omit for a link with no reading (a UPS charging loop):
   * it is drawn at the floor width.
   */
  powerW?: number;
}

/**
 * The balance line above the diagram (spec 197, FR-E1): what the card answers
 * first. A coloured dot and a label, one large figure, an optional sentence.
 */
export interface FlowHeadline {
  /** Colour of the 8 px dot before the label: a fill, never text. */
  dotColor: string;
  label: string;
  /** Pre-formatted figure, in ink. */
  value: string;
  unit?: string;
  sentence?: ReactNode;
}

export interface FlowDiagramProps {
  nodes: FlowNodeSpec[];
  links: FlowLinkSpec[];
  /** The balance line, rendered above the diagram. */
  headline?: FlowHeadline;
  /**
   * Sentence describing the whole flow for screen readers. When given, the
   * visible headline, nodes and share bars are hidden from assistive
   * technology, so the figures are not read twice.
   */
  ariaLabel?: string;
}

/** The ribbon's floor and ceiling, in screen pixels. */
export const RIBBON_MIN = 2.5;
export const RIBBON_MAX = 18;

/**
 * Spec 197 (FR-E4.1) — the ribbon's width in screen pixels for a power:
 * 2.5 px plus 1 px per 200 W up to 2 kW (12.5 px), then logarithmic (3 px per
 * doubling), capped at 18 px; × 0.8 in a narrow diagram, never under the
 * floor. Continuous, so 180 W and 4.9 kW look as different as they are, and
 * bounded, so a 10 kW charger and a 30 W UPS share one scale.
 */
export function ribbonWidth(powerW: number | undefined, narrow = false): number {
  const p = Math.abs(powerW ?? 0);
  const w = Math.min(p <= 2000 ? RIBBON_MIN + p / 200 : 12.5 + 3 * Math.log2(p / 2000), RIBBON_MAX);
  return narrow ? Math.max(RIBBON_MIN, w * 0.8) : w;
}

/** The wave's speed in screen pixels a second: 18 px/s near zero, √-scaled, flat from 8 kW. */
export function waveSpeed(powerW: number | undefined): number {
  const p = Math.min(Math.abs(powerW ?? 0), 8000);
  return 18 + 70 * Math.sqrt(p / 3000);
}

/** One wave every 150 px along the ribbon (keep in step with `flow-wave` in index.css). */
export const WAVE_PERIOD = 150;

/**
 * The wave: three dashes stacked on one path, centred on each other, longest
 * and faintest first, so the colour swells and fades instead of marching in
 * beads. Lengths in screen pixels, from the ribbon's width.
 */
export function waveDashes(width: number): { length: number; opacity: number }[] {
  const L = 26 + 2 * width;
  return [
    { length: L, opacity: 0.3 },
    { length: L * 0.6, opacity: 0.55 },
    { length: L * 0.3, opacity: 1 },
  ];
}

/** Below this, a route is noise: skeleton only, no ribbon. */
export const FLOW_FLOOR_W = 5;

/** The arrowhead at the route's end, sized on the ribbon: base w + 10, length 0.55 w + 7. */
export function headSize(width: number): { base: number; length: number } {
  return { base: width + 10, length: width * 0.55 + 7 };
}

/** Which node a route enters, and on which side of it. */
export const ROUTE_TARGET: Record<FlowEdge, { slot: FlowSlot; side: "left" | "right" | "bottom" }> =
  {
    leftToFocal: { slot: "focal", side: "left" },
    rightToFocal: { slot: "focal", side: "right" },
    rightToLeft: { slot: "left", side: "bottom" },
    leftToRight: { slot: "right", side: "bottom" },
  };
