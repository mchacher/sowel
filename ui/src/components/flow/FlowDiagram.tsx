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
 * What the diagram owns: the viewBox, the node slots, the three Manhattan
 * routes, the always-visible skeleton, the active overlay, the bubbles, the
 * pill placement and the status tag. What the caller owns: which edges carry
 * energy, in which direction, with what colours and formatted values.
 */

import { useId } from "react";

import {
  PATHS,
  PILL_POSITION,
  SLOT_BOX,
  SLOT_VALUE,
  flowDuration,
  type FlowDiagramProps,
  type FlowNodeSpec,
} from "./flow-geometry";

/** Small pill drawn on top of a flow route. */
function Pill({
  children,
  className,
  color,
}: {
  children: React.ReactNode;
  className?: string;
  color: string;
}) {
  return (
    <div
      className={`absolute font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface border z-20 ${className ?? ""}`}
      style={{ color, borderColor: color }}
    >
      {children}
    </div>
  );
}

function FlowNode({ node }: { node: FlowNodeSpec }) {
  const unitClass =
    node.slot === "focal"
      ? "text-[11px] font-semibold opacity-60"
      : "text-[11px] text-text-tertiary font-semibold";

  return (
    <div
      className={`absolute flex items-center justify-center bg-surface border border-border rounded-[14px] z-10 ${SLOT_BOX[node.slot]}`}
      style={{ color: node.color }}
    >
      <div
        className={`flex flex-col items-center justify-center gap-1 ${node.dimmed ? "opacity-40" : ""}`}
      >
        <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          {node.label}
        </div>
        {node.icon}
        <div
          className={`font-mono font-bold leading-none tracking-tight flex items-baseline gap-1 ${SLOT_VALUE[node.slot]}`}
        >
          {node.valuePrefix}
          <span>{node.value}</span>
          {node.unit && <span className={unitClass}>{node.unit}</span>}
        </div>
        {node.sub && (
          <div className="font-mono text-[10px] text-text-tertiary leading-none">{node.sub}</div>
        )}
      </div>
    </div>
  );
}

export function FlowDiagram({ nodes, links, tag, ariaLabel }: FlowDiagramProps) {
  // Unique per instance so two diagrams on one page cannot collide on their
  // <mpath> references — the ids were hardcoded while this lived in Live.
  const uid = useId().replace(/:/g, "");

  return (
    <div className="relative h-[300px] sm:h-auto sm:aspect-[3/2] max-w-[600px]">
      <svg
        viewBox="0 0 540 360"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full overflow-visible"
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
      >
        {/* Skeleton — every declared route stays faintly visible, so the whole
            circuit reads even when a single branch is working. */}
        {links.map((l) => (
          <path
            key={`sk-${l.edge}`}
            d={PATHS[l.edge]}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}

        {/* Active overlays */}
        {links
          .filter((l) => l.active)
          .map((l) => (
            <path
              key={`ov-${l.edge}`}
              d={PATHS[l.edge]}
              fill="none"
              stroke={l.color}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ))}

        {/* Invisible motion references */}
        {links
          .filter((l) => l.active)
          .map((l) => (
            <path key={`mp-${l.edge}`} id={`${uid}-${l.edge}`} d={PATHS[l.edge]} fill="none" stroke="none" />
          ))}

        {/* Bubbles. Each circle stays hidden until its stagger fires, otherwise
            it would flash at the SVG origin before its motion starts. */}
        {links
          .filter((l) => l.active)
          .map((l) => {
            const dur = flowDuration(l.magnitude);
            if (dur <= 0) return null;
            return (
              <g key={`bb-${l.edge}`}>
                {[0, dur / 3, (2 * dur) / 3].map((begin, i) => (
                  <circle key={i} r="4" fill={l.color} opacity="0">
                    <set attributeName="opacity" to="1" begin={`${begin}s`} />
                    <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite">
                      <mpath href={`#${uid}-${l.edge}`} />
                    </animateMotion>
                  </circle>
                ))}
              </g>
            );
          })}
      </svg>

      {links.map(
        (l) =>
          l.pill && (
            <Pill key={`pl-${l.edge}`} className={PILL_POSITION[l.edge]} color={l.pill.color}>
              {l.pill.text}
            </Pill>
          ),
      )}

      {nodes.map((n) => (
        <FlowNode key={n.slot} node={n} />
      ))}

      {tag && (
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-[8%] font-mono text-[12px] font-bold px-3 py-1 rounded-full z-10"
          style={{
            color: tag.color,
            background: `color-mix(in srgb, ${tag.color} 12%, transparent)`,
          }}
        >
          {tag.text}
        </span>
      )}
    </div>
  );
}
