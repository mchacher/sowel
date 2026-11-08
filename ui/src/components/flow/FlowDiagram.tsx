/**
 * FlowDiagram — the three-node power-routing diagram (spec 157).
 *
 * Extracted from Energy · Live (spec 148), where it was inlined, so a second
 * surface can reuse it instead of cloning its geometry: the UPS panel
 * (spec 156) maps onto the very same shape — two sources, one load, and a path
 * that switches.
 *
 *        ┌─────────┐
 *        │  focal  │        Energy · Live : Maison / Réseau / Production
 *        └────┬────┘        UPS           : Équipements / Secteur / Batterie
 *     ┌───────┴───────┐
 * ┌───┴───┐       ┌───┴───┐
 * │ left  │╌╌╌╌╌╌╌│ right │   the bottom edge is the two sources exchanging:
 * └───────┘       └───────┘   solar export one way, battery charge the other.
 *
 * What the diagram owns: the headline above it, the viewBox, the node slots,
 * the routes (a skeleton at rest; a ribbon whose width follows the power, its
 * wave and its arrowhead when active) and the share bars under the values.
 * What the caller owns: which edges carry energy, in which direction, how
 * many watts, with what colours, and every formatted figure.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  FLOW_FLOOR_W,
  PATHS,
  ROUTE_TARGET,
  SLOT_ANCHOR,
  SLOT_BAR,
  SLOT_ICON_ROW,
  SLOT_LABEL,
  SLOT_VALUE,
  VIEWBOX_HEIGHT,
  WAVE_PERIOD,
  headSize,
  ribbonWidth,
  waveDashes,
  waveSpeed,
  type FlowDiagramProps,
  type FlowHeadline,
  type FlowLinkSpec,
  type FlowNodeSpec,
  type FlowShareBar,
} from "./flow-geometry";

/** A route carrying power, as drawn: under the floor it is skeleton only. */
function isLit(l: FlowLinkSpec): boolean {
  return l.active && !(l.powerW !== undefined && Math.abs(l.powerW) < FLOW_FLOOR_W);
}

/**
 * The arrowhead where a ribbon enters its node (spec 197, FR-E4.3): a solid
 * head sized on the ribbon, its tip on the node's edge, on a pad in the
 * card's colour that swallows the ribbon's end and its wave. Never a mark in
 * the middle of a route. Part of the node, so it follows the node's real
 * edge at every size.
 */
function Head({ link, side }: { link: FlowLinkSpec; side: "left" | "right" | "bottom" }) {
  const { base, length } = headSize(ribbonWidth(link.powerW));
  const place =
    side === "left"
      ? "right-full top-1/2 -translate-y-1/2"
      : side === "right"
        ? "left-full top-1/2 -translate-y-1/2"
        : "top-full left-1/2 -translate-x-1/2";
  const vertical = side === "bottom";
  const [w, h] = vertical ? [base, length] : [length, base];
  const points =
    side === "left"
      ? `0,0 ${length},${base / 2} 0,${base}`
      : side === "right"
        ? `${length},0 0,${base / 2} ${length},${base}`
        : `0,${length} ${base / 2},0 ${base},${length}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={`absolute block pointer-events-none ${place}`}
      data-testid="flow-end-cap"
      data-edge={link.edge}
    >
      <rect width={w} height={h} fill="var(--color-surface)" />
      <polygon points={points} fill={link.color} />
    </svg>
  );
}

/**
 * Spec 197 (FR-E7) — the share bar under a node's value: 6 px, segmented in
 * route order and route colours, the first and last percentages at its ends.
 * A level (one part under 1) shows the track for the rest and no figure, the
 * value above already says it. Decoration to a screen reader: the diagram's
 * sentence carries the shares.
 */
function ShareBar({ bar, slot }: { bar: FlowShareBar; slot: FlowNodeSpec["slot"] }) {
  const parts = bar.parts.filter((p) => p.share > 0);
  if (parts.length === 0) return null;
  const level = parts.length === 1 && parts[0].share < 0.999;
  const first = parts[0];
  const last = parts[parts.length - 1];
  return (
    <div className={`${SLOT_BAR[slot]} mt-1`} aria-hidden="true" data-testid="flow-share-bar">
      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-(--n-100)">
        {parts.map((p, i) => (
          <span
            key={i}
            className="h-full rounded-full"
            data-share={p.share}
            style={
              level
                ? { width: `${Math.round(p.share * 1000) / 10}%`, background: p.color }
                : { flex: `${p.share} 1 0`, background: p.color }
            }
          />
        ))}
      </div>
      {parts.length > 1 && (first.label || last.label) && (
        <div className="flex justify-between mt-0.5 text-micro font-medium text-text-secondary tabular-nums leading-tight">
          <span>{first.label}</span>
          <span>{last.label}</span>
        </div>
      )}
    </div>
  );
}

/**
 * One node, built around its icon: the icon's centre sits on the slot's
 * anchor, where the routes meet it; the label hangs above, the value, its
 * sub-line and the share bar below. Each part is a box in the card's colour,
 * so the routes passing under the node are masked, and the arrowheads sit on
 * the boxes' real edges. The node's colour is on the icon only; the figures
 * are in ink (#1126).
 */
function FlowNode({ node, incoming }: { node: FlowNodeSpec; incoming: FlowLinkSpec[] }) {
  const anchor = SLOT_ANCHOR[node.slot];
  const dim = node.dimmed ? "opacity-40" : "";
  const headAt = (side: "left" | "right" | "bottom") =>
    incoming
      .filter((l) => ROUTE_TARGET[l.edge].side === side)
      .map((l) => <Head key={l.edge} link={l} side={side} />);
  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
      data-slot={node.slot}
    >
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-max bg-surface pb-1 px-1">
        <div
          className={`font-medium text-text-tertiary leading-tight whitespace-nowrap ${SLOT_LABEL[node.slot]} ${dim}`}
        >
          {node.label}
        </div>
      </div>
      <div className={`relative flex justify-center bg-surface ${SLOT_ICON_ROW[node.slot]}`}>
        <span className={`flex ${dim}`} data-testid="flow-node-icon" style={{ color: node.color }}>
          {node.icon}
        </span>
        {headAt("left")}
        {headAt("right")}
      </div>
      <div className="absolute top-full left-1/2 -translate-x-1/2 w-max bg-surface pt-1 px-1 flex flex-col items-center gap-1">
        <div className={`flex flex-col items-center gap-1 ${dim}`}>
          <div
            className={`tabular-nums font-semibold leading-none flex items-baseline whitespace-nowrap text-text ${SLOT_VALUE[node.slot]}`}
          >
            <span>{node.value}</span>
            {node.unit && (
              <span className="text-micro text-text-tertiary font-semibold">{node.unit}</span>
            )}
          </div>
          {node.sub && (
            <div className="text-micro text-text-tertiary leading-none whitespace-nowrap">
              {node.sub}
            </div>
          )}
          {node.bar && <ShareBar bar={node.bar} slot={node.slot} />}
        </div>
        {headAt("bottom")}
      </div>
    </div>
  );
}

/**
 * The balance line (spec 197, FR-E1): the one answer the card gives first, in
 * the 40 px value size, before the reader has to decode the routes.
 */
function Headline({ headline }: { headline: FlowHeadline }) {
  return (
    <div className="mb-4" data-testid="flow-headline">
      <div className="flex items-center gap-2 text-small text-text-secondary">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: headline.dotColor }}
          data-testid="flow-headline-dot"
        />
        {headline.label}
      </div>
      <div className="flex items-baseline gap-1.5 tabular-nums font-semibold text-value leading-tight text-text">
        <span>{headline.value}</span>
        {headline.unit && (
          <span className="text-lead font-semibold text-text-tertiary">{headline.unit}</span>
        )}
      </div>
      {headline.sentence && (
        <p className="text-small text-text-secondary mt-0.5">{headline.sentence}</p>
      )}
    </div>
  );
}

/**
 * One active route (spec 197, FR-E4): a halo (dark theme only), a band tinted
 * from the route's colour whose width follows the power, and a three-dash
 * wave moving along it at a speed that follows the power too. Strokes are
 * non-scaling, so widths and dashes are screen pixels on the phone's
 * stretched viewBox as on a desktop; the narrow width (× 0.8) is switched by
 * the diagram's container query. Under reduced motion the wave is hidden and
 * the band takes more colour (index.css).
 */
function Ribbon({ link }: { link: FlowLinkSpec }): ReactNode {
  const wide = ribbonWidth(link.powerW);
  const narrow = ribbonWidth(link.powerW, true);
  const d = PATHS[link.edge];
  const vars = {
    "--flow-c": link.color,
    "--rw": `${narrow}px`,
    "--rw-wide": `${wide}px`,
  } as CSSProperties;
  const seconds = WAVE_PERIOD / waveSpeed(link.powerW);
  return (
    <g style={vars} data-edge={link.edge} data-width={wide}>
      <path
        d={d}
        fill="none"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="flow-halo [stroke-width:calc(var(--rw)+9px)] @lg:[stroke-width:calc(var(--rw-wide)+9px)]"
      />
      <path
        d={d}
        fill="none"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="flow-band [stroke-width:var(--rw)] @lg:[stroke-width:var(--rw-wide)]"
        data-testid="flow-ribbon"
      />
      {waveDashes(wide).map((dash, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={link.color}
          strokeOpacity={dash.opacity}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="flow-wave [stroke-width:var(--rw)] @lg:[stroke-width:var(--rw-wide)]"
          style={
            {
              strokeDasharray: `${dash.length} ${WAVE_PERIOD - dash.length}`,
              "--o0": `${dash.length / 2}px`,
              animationDuration: `${Math.round(seconds * 100) / 100}s`,
            } as CSSProperties
          }
          data-testid="flow-wave"
        />
      ))}
    </g>
  );
}

export function FlowDiagram({ nodes, links, headline, ariaLabel }: FlowDiagramProps) {
  const lit = links.filter(isLit);
  // With a sentence for screen readers, everything visible is decoration to
  // them: the figures would otherwise be read twice, once out of order.
  const hidden = ariaLabel ? true : undefined;

  return (
    // The headline starts at the card's content edge, like a card's title,
    // whatever the card's width; the diagram is centred under it, in the
    // container whose width sizes the nodes and the ribbons (`@lg:`).
    <div role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      {headline && (
        <div aria-hidden={hidden}>
          <Headline headline={headline} />
        </div>
      )}
      <div className="@container max-w-[600px] mx-auto">
        <div className="relative h-[280px] @lg:h-auto @lg:aspect-[54/29]" aria-hidden={hidden}>
          <svg
            viewBox={`0 0 540 ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full overflow-visible"
          >
            {/* Skeleton — every declared route that carries nothing stays
                faintly visible, so the whole circuit reads. */}
            {links
              .filter((l) => !isLit(l))
              .map((l) => (
                <path
                  key={`sk-${l.edge}`}
                  d={PATHS[l.edge]}
                  fill="none"
                  stroke="var(--color-border)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {lit.map((l) => (
              <Ribbon key={`rb-${l.edge}`} link={l} />
            ))}
          </svg>

          {nodes.map((n) => (
            <FlowNode
              key={n.slot}
              node={n}
              incoming={lit.filter((l) => ROUTE_TARGET[l.edge].slot === n.slot)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
