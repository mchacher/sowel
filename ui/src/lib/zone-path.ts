import type { ZoneWithChildren } from "../types";

/**
 * Zone and equipment labelling for flat controls — dropdowns, option lists,
 * chips (spec 139).
 *
 * Wherever the zone tree is flattened, the leaf name alone stops identifying a
 * zone: a house with a bathroom per floor or per building shows the same
 * `Salle de bain` several times, and integrations name every sensor alike
 * (`Température`). Hierarchical views (sidebar, zone tree) get that context
 * from their shape; a `<select>` has to spell it out.
 *
 * Spelling out the *full* path would trade one problem for another — a compact
 * dropdown truncates `Maison Principale › Maison › Salle de bain` back into
 * uselessness. So a label carries the **shortest suffix that disambiguates**:
 * the bare name when it is unique, one ancestor when that is enough, more only
 * where the tree really repeats itself.
 */

/** Separator between path segments, shared with the topbar breadcrumb. */
export const ZONE_PATH_SEPARATOR = " › ";

export interface ZoneOption {
  id: string;
  name: string;
  /** Shortest ancestor suffix that tells this zone from its homonyms. */
  label: string;
  /** Ancestor names, outermost first, own name last. */
  chain: string[];
  /** Full ancestor chain, for tooltips and any caller that wants everything. */
  path: string;
  /** Depth in the tree, 0 for a root. Drives option indentation. */
  depth: number;
}

interface Walked {
  id: string;
  name: string;
  /** Ancestor names, outermost first, own name last. */
  chain: string[];
  depth: number;
}

/**
 * Flatten the zone tree, labelling every zone with the shortest suffix that
 * distinguishes it from the zones sharing its name.
 *
 * A single top-level root is dropped from the chains: it is the whole
 * installation and discriminates nothing (the topbar breadcrumb treats it as
 * implicit for the same reason). Its own label stays its name, so a root never
 * renders empty. With several roots the top level is meaningful and stays.
 *
 * Order is depth-first, so a dropdown reads like the tree.
 */
export function flattenZonesWithPath(tree: ZoneWithChildren[]): ZoneOption[] {
  const walked: Walked[] = [];
  const implicitRoot = tree.length === 1;

  const walk = (nodes: ZoneWithChildren[], depth: number, ancestors: string[]): void => {
    for (const node of nodes) {
      const chain = [...ancestors, node.name];
      walked.push({ id: node.id, name: node.name, chain, depth });
      // The implicit root labels itself but is not carried into its children.
      const childAncestors = implicitRoot && depth === 0 ? [] : chain;
      if (node.children.length > 0) walk(node.children, depth + 1, childAncestors);
    }
  };
  walk(tree, 0, []);

  const byName = new Map<string, Walked[]>();
  for (const zone of walked) {
    const group = byName.get(zone.name);
    if (group) group.push(zone);
    else byName.set(zone.name, [zone]);
  }

  // Segments needed per name group: the same count for the whole group, so its
  // labels stay comparable ("Maison › Salle de bain" vs "RDC › Salle de bain").
  const segmentsFor = new Map<string, number>();
  for (const [name, group] of byName) {
    segmentsFor.set(name, group.length > 1 ? segmentsToSeparate(group.map((z) => z.chain)) : 1);
  }

  return walked.map((zone) => ({
    id: zone.id,
    name: zone.name,
    label: suffix(zone.chain, segmentsFor.get(zone.name) ?? 1),
    chain: zone.chain,
    path: zone.chain.join(ZONE_PATH_SEPARATOR),
    depth: zone.depth,
  }));
}

/** Last `count` segments of a chain, joined. */
function suffix(chain: string[], count: number): string {
  return chain.slice(Math.max(0, chain.length - count)).join(ZONE_PATH_SEPARATOR);
}

/**
 * Smallest suffix length that tells the given chains apart, capped at the
 * longest chain. Falls back to that cap when they cannot be separated at all.
 */
function segmentsToSeparate(chains: string[][]): number {
  const longest = Math.max(...chains.map((c) => c.length));
  for (let n = 1; n < longest; n++) {
    if (new Set(chains.map((c) => suffix(c, n))).size === chains.length) return n;
  }
  return longest;
}

/**
 * Label a list of equipment candidates: bare name when it is unique in that
 * list, `name — zone` when it is not. Qualifying every option instead would
 * push the useful part out of a compact dropdown for no gain.
 *
 * The zone qualifier is the shortest suffix that separates the *candidates*,
 * not the shortest that separates every zone in the house: three ventilations
 * sitting in three plainly different rooms only need the room name, however
 * deep those rooms are.
 *
 * Two equipments sharing a name *and* a zone stay identical — nothing but a
 * rename can tell those apart, and inventing an index would only look like
 * information.
 */
export function equipmentLabelMap(
  equipments: { id: string; name: string; zoneId: string }[],
  zoneChains: Map<string, string[]>,
): Map<string, string> {
  const byName = new Map<string, { id: string; name: string; zoneId: string }[]>();
  for (const eq of equipments) {
    const group = byName.get(eq.name);
    if (group) group.push(eq);
    else byName.set(eq.name, [eq]);
  }

  const labels = new Map<string, string>();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0].id, name);
      continue;
    }
    const chains = group.map((eq) => zoneChains.get(eq.zoneId) ?? []);
    const segments = segmentsToSeparate(chains);
    group.forEach((eq, i) => {
      const zone = suffix(chains[i], segments);
      labels.set(eq.id, zone ? `${name} — ${zone}` : name);
    });
  }
  return labels;
}

/** `zoneId → ancestor chain` lookup, the input of {@link equipmentLabelMap}. */
export function zoneChainMap(options: ZoneOption[]): Map<string, string[]> {
  return new Map(options.map((z) => [z.id, z.chain]));
}
