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
 * the three Manhattan routes, the always-visible skeleton, the active overlay
 * with its width by power tier, the moving dots, the end caps and the pill
 * placement. What the caller owns: which edges carry energy, in which
 * direction, how many watts, with what colours and formatted values.
 */

import {
  FLOW_DOT_FLOOR_W,
  FLOW_DOT_PERIOD,
  FLOW_TIER_STYLE,
  PATHS,
  PILL_POSITION,
  ROUTE_END,
  SLOT_BOX,
  SLOT_LABEL,
  SLOT_VALUE,
  VIEWBOX_HEIGHT,
  flowDotSeconds,
  flowTier,
  type FlowDiagramProps,
  type FlowHeadline,
  type FlowLinkSpec,
  type FlowNodeSpec,
} from "./flow-geometry";

/**
 * A short figure by a route (spec 197, FR-E3.4): plain secondary text on a
 * surface pad that masks the line under it. No border and no fill: on a card
 * that already carries a headline, ten pills on one screen meant none of them
 * signalled anything.
 */
function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`absolute tabular-nums text-caption font-medium px-1.5 bg-surface text-text-secondary z-20 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/**
 * One node. Its colour goes to the icon only: the value is in ink, the label
 * and unit in the tertiary grey (#1126). The box is the card's own surface
 * (spec 197): it exists to mask the skeleton route behind the icon, not to be
 * seen, and a page-coloured well read as a hole in dark.
 */
function FlowNode({ node }: { node: FlowNodeSpec }) {
  return (
    <div
      className={`absolute flex items-center justify-center bg-surface rounded-md z-10 ${SLOT_BOX[node.slot]}`}
    >
      <div
        className={`flex flex-col items-center justify-center gap-1 ${node.dimmed ? "opacity-40" : ""}`}
      >
        <div
          className={`font-medium text-text-tertiary leading-tight whitespace-nowrap ${SLOT_LABEL[node.slot]}`}
        >
          {node.label}
        </div>
        <span className="flex" data-testid="flow-node-icon" style={{ color: node.color }}>
          {node.icon}
        </span>
        <div
          className={`tabular-nums font-semibold leading-none flex items-baseline whitespace-nowrap text-text ${SLOT_VALUE[node.slot]}`}
        >
          <span>{node.value}</span>
          {node.unit && (
            <span className="text-micro text-text-tertiary font-semibold">{node.unit}</span>
          )}
        </div>
        {node.sub && <div className="text-micro text-text-tertiary leading-none">{node.sub}</div>}
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
 * The direction cue at rest: an arrowhead where the route enters its
 * destination node, its tip on the node's edge (spec 197, FR-E4.3). It is the
 * line's own end, sized from the route's width, so a still frame or a reduced
 * motion setting still says which way the power goes. The maintainer turned
 * down a chevron in the middle of the route; an open chevron and a long taper
 * at the end were tried on still frames too, and read less clearly than this
 * solid head in both themes (the PR has the frames).
 *
 * A pad in the card's colour sits under the head, so the moving dots vanish
 * into its base instead of poking out past its tip.
 *
 * Drawn in HTML over the SVG rather than as an SVG marker: the viewBox is
 * stretched (`preserveAspectRatio="none"`), which would squash a marker on a
 * phone, while this box keeps its pixels at every size.
 */
function EndCap({ link }: { link: FlowLinkSpec }) {
  const end = ROUTE_END[link.edge];
  const { width } = FLOW_TIER_STYLE[flowTier(link.powerW)];
  // Base and length grow with the route, so a 4 px route does not end in a
  // head sized for a 2 px one.
  const base = 2 * width + 6;
  const length = width + 7;
  return (
    <span
      className="absolute w-0 h-0 z-20 pointer-events-none left-(--cap-left) sm:left-(--cap-left-sm)"
      style={
        {
          "--cap-left": `${end.left}%`,
          "--cap-left-sm": `${end.smLeft}%`,
          top: `${end.top}%`,
          transform: `rotate(${end.angle}deg)`,
          transformOrigin: "0 0",
        } as React.CSSProperties
      }
      data-testid="flow-end-cap"
      data-edge={link.edge}
    >
      <svg
        width={length}
        height={base}
        viewBox={`0 0 ${length} ${base}`}
        className="absolute block"
        style={{ left: -length, top: -base / 2 }}
      >
        <rect width={length} height={base} fill="var(--color-surface)" />
        <path d={`M 0 0 L ${length} ${base / 2} L 0 ${base} Z`} fill={link.color} />
      </svg>
    </span>
  );
}

export function FlowDiagram({ nodes, links, headline, ariaLabel }: FlowDiagramProps) {
  const active = links.filter((l) => l.active);
  // With a sentence for screen readers, everything visible is decoration to
  // them: the figures would otherwise be read twice, once out of order.
  const hidden = ariaLabel ? true : undefined;

  return (
    <div role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      {headline && (
        <div aria-hidden={hidden}>
          <Headline headline={headline} />
        </div>
      )}
      <div
        className="relative h-[260px] sm:h-auto sm:aspect-[54/29] max-w-[600px] mx-auto"
        aria-hidden={hidden}
      >
        <svg
          viewBox={`0 0 540 ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full overflow-visible"
        >
          {/* Skeleton — every declared route stays faintly visible, so the whole
              circuit reads even when a single branch is working. */}
          {links.map((l) => (
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

          {/* Active overlays: the width says how much (spec 197, FR-E4.1). */}
          {active.map((l) => (
            <path
              key={`ov-${l.edge}`}
              d={PATHS[l.edge]}
              fill="none"
              stroke={l.color}
              strokeWidth={FLOW_TIER_STYLE[flowTier(l.powerW)].width}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              data-tier={flowTier(l.powerW)}
            />
          ))}

          {/* Moving dots: round-capped zero-length dashes on the same path,
              moved by a CSS animation (spec 197, FR-E4.2). A non-scaling
              stroke keeps them round on the phone's stretched viewBox, and
              the reduced-motion setting stops them (index.css). */}
          {active.map((l) => {
            if (l.powerW !== undefined && Math.abs(l.powerW) < FLOW_DOT_FLOOR_W) return null;
            const tier = flowTier(l.powerW);
            return (
              <path
                key={`dt-${l.edge}`}
                d={PATHS[l.edge]}
                fill="none"
                stroke={l.color}
                strokeWidth={FLOW_TIER_STYLE[tier].dot}
                strokeLinecap="round"
                strokeDasharray={`0 ${FLOW_DOT_PERIOD}`}
                vectorEffect="non-scaling-stroke"
                className="flow-dash"
                style={{ animationDuration: `${flowDotSeconds(tier)}s` }}
                data-testid="flow-dots"
              />
            );
          })}
        </svg>

        {active.map((l) => (
          <EndCap key={`cap-${l.edge}`} link={l} />
        ))}

        {links.map(
          (l) =>
            l.pill && (
              <Pill key={`pl-${l.edge}`} className={PILL_POSITION[l.edge]}>
                {l.pill.text}
              </Pill>
            ),
        )}

        {nodes.map((n) => (
          <FlowNode key={n.slot} node={n} />
        ))}
      </div>
    </div>
  );
}
