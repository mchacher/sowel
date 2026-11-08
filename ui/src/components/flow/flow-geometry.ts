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
 * The viewBox is 540 × 290 (spec 197). It was 540 × 360 while a status tag
 * sat in a band under the bottom route; the headline above the diagram
 * replaced the tag, and the band would have been 70 units of nothing. The
 * routes did not move, only the frame's bottom edge.
 *
 * Box geometry (heights explicit so the centres are deterministic):
 *   focal  top-0               h-[45%] w-[36%] → y   0..130, centre (270,  65)
 *                                       sm:w-[24%] (x 205..335, see SLOT_BOX)
 *   left   top-[62%] centred   h-[36%] w-[22%] → y 128..232, centre ( 60, 180)
 *   right  top-[62%] centred   h-[36%] w-[22%] → y 128..232, centre (480, 180)
 * Below `sm` the satellites are 24 % wide from -1 %: same centres (#1129).
 */
export const VIEWBOX_HEIGHT = 290;
export const PATHS: Record<FlowEdge, string> = {
  leftToFocal: "M 60 180 V 75 Q 60 65 70 65 H 270",
  rightToFocal: "M 480 180 V 75 Q 480 65 470 65 H 270",
  rightToLeft: "M 480 180 V 255 Q 480 270 470 270 H 70 Q 60 270 60 255 V 180",
  leftToRight: "M 60 180 V 255 Q 60 270 70 270 H 470 Q 480 270 480 255 V 180",
};

/** Where an edge's pill sits: mid of the visible vertical leg, or the bottom run. */
export const PILL_POSITION: Record<FlowEdge, string> = {
  leftToFocal: "left-[11%] top-[35%] -translate-x-1/2 -translate-y-1/2",
  rightToFocal: "right-[11%] top-[35%] translate-x-1/2 -translate-y-1/2",
  rightToLeft: "left-1/2 top-[93%] -translate-x-1/2 -translate-y-1/2",
  leftToRight: "left-1/2 top-[93%] -translate-x-1/2 -translate-y-1/2",
};

// A satellite node is 22 % of the diagram from `sm`, 24 % below it with 2 px
// of side padding. On a phone the diagram is the viewport less 64 px (page
// and card padding). At 22 % with 4 px of padding the widest figure,
// « ↑ 10,5 kW » (61 px), ran 3.8 px past the content box at 360 px and
// 0.5 px at 390 px, and « Production » filled it to the pixel (#1129,
// measured in Chromium). Now the content box is 67 px at 360 px, 74 px at
// 390 px. Below `sm` the box also steps 1 % outward so its centre stays at
// 11 % / 89 %, where the routes of PATHS meet it (x = 60 and 480 of 540).
// The focal box takes 8 px of side padding below `sm`: « Consommation », set
// at 12 px, ran 2 px past its content box at 360 px with 12 px of padding.
// From `sm` it narrows to 24 % (130 px at the narrowest, 144 px at 600 px,
// « Consommation » and « 10,5 kW » need about 90): the box is the card's
// own colour since spec 197, so the routes appear to end where it starts, and
// at 36 % they stopped 50 px short of the node they feed.
export const SLOT_BOX: Record<FlowSlot, string> = {
  focal: "top-0 left-1/2 -translate-x-1/2 w-[36%] sm:w-[24%] h-[45%] px-2 sm:px-3 py-2",
  left: "top-[62%] -translate-y-1/2 -left-[1%] sm:left-0 w-[24%] sm:w-[22%] h-[36%] px-0.5 sm:px-2 py-2",
  right:
    "top-[62%] -translate-y-1/2 -right-[1%] sm:right-0 w-[24%] sm:w-[22%] h-[36%] px-0.5 sm:px-2 py-2",
};

export const SLOT_LABEL: Record<FlowSlot, string> = {
  focal: "text-caption sm:text-small",
  left: "text-micro sm:text-small",
  right: "text-micro sm:text-small",
};

export const SLOT_VALUE: Record<FlowSlot, string> = {
  focal: "text-title sm:text-display gap-1 mt-1",
  left: "text-body sm:text-title gap-0.5 sm:gap-1",
  right: "text-body sm:text-title gap-0.5 sm:gap-1",
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
  /** Paints the icon only; the value is always in ink (#1126). */
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
  /** False → the route is drawn as skeleton only, with no overlay and no dots. */
  active: boolean;
  /**
   * Absolute watts on the route (spec 197): picks the tier, so the stroke
   * width and the dot speed. Omit for a link with no reading (a UPS charging
   * loop): it is drawn at the first tier.
   */
  powerW?: number;
  /** A short figure by the route, in secondary text on a surface pad. */
  pill?: { text: string };
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
   * visible headline, nodes and pills are hidden from assistive technology,
   * so the figures are not read twice.
   */
  ariaLabel?: string;
}

/** Power tier of a route: 1 below 500 W, 2 up to 2 kW, 3 from 2 kW. */
export type FlowTier = 1 | 2 | 3;

export function flowTier(powerW: number | undefined): FlowTier {
  const a = Math.abs(powerW ?? 0);
  if (a >= 2000) return 3;
  if (a >= 500) return 2;
  return 1;
}

/** Below this, a route is lit but carries no moving dots: rounding noise. */
export const FLOW_DOT_FLOOR_W = 5;

/**
 * Screen-pixel strokes per tier. The routes are drawn with
 * `vector-effect: non-scaling-stroke`, so these are the widths on screen at
 * every size, the phone's squeezed viewBox included (spec 197, FR-E4).
 * `dot` is the round-capped dash diameter, wider than the route so the dots
 * read on top of it; `speed` is how fast the dots move, in pixels a second.
 */
export const FLOW_TIER_STYLE: Record<FlowTier, { width: number; dot: number; speed: number }> = {
  1: { width: 2, dot: 6, speed: 16 },
  2: { width: 3, dot: 7, speed: 32 },
  3: { width: 4, dot: 8, speed: 56 },
};

/** Distance between two dots, in screen pixels: `stroke-dasharray: 0 P`. */
export const FLOW_DOT_PERIOD = 20;

/** Seconds a dot takes to move one period at a tier's speed. */
export function flowDotSeconds(tier: FlowTier): number {
  return FLOW_DOT_PERIOD / FLOW_TIER_STYLE[tier].speed;
}

/**
 * Where each route enters its destination node, as a percentage of the
 * diagram, and the way it is heading there (degrees, 0 = towards the right).
 * The direction cue sits here, at the end of the route, never mid-route
 * (spec 197, FR-E4.3: the maintainer turned down a mid-route chevron).
 *
 * From the box geometry above: the focal box spans 32..68 % of the width
 * below `sm` and 38..62 % from it (`smLeft`); the satellites end at
 * y 62 % + 36 % / 2 = 80 % of the height. The phone's wider satellites keep
 * the same centre and height, so their points hold at every size.
 */
export const ROUTE_END: Record<
  FlowEdge,
  { left: number; smLeft: number; top: number; angle: number }
> = {
  leftToFocal: { left: 32, smLeft: 38, top: (65 / VIEWBOX_HEIGHT) * 100, angle: 0 },
  rightToFocal: { left: 68, smLeft: 62, top: (65 / VIEWBOX_HEIGHT) * 100, angle: 180 },
  rightToLeft: { left: (60 / 540) * 100, smLeft: (60 / 540) * 100, top: 80, angle: -90 },
  leftToRight: { left: (480 / 540) * 100, smLeft: (480 / 540) * 100, top: 80, angle: -90 },
};
