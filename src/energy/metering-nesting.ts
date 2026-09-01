// ============================================================
// Nested submeters (spec 173)
// ============================================================
//
// The by-usage breakdown splits the household total into slices and calls the
// rest "other": `other = total − Σ submeters`. That arithmetic holds only while
// the submeters are disjoint, and switchboards are not. A gîte clamp and, fed
// from that same board, a water-heater clamp both enrol as submeters (#523), so
// the heater's kilowatt-hours land in two slices and the residual loses them.
//
// An equipment can now declare `meteringParentId`: "my consumption is already
// counted by that meter". These three pure functions are what the breakdown
// and the API do with that declaration — no database, no Influx, so the
// arithmetic can be tested for what it is.

/** One bucket of a submeter series. */
export interface NestingPoint {
  time: string;
  wh: number;
}

interface NestableEquipment {
  id: string;
  meteringParentId?: string | null;
}

/**
 * parentId → ids of the meters that declared themselves inside it.
 *
 * Only DIRECT children, which is the whole trick for a chain: with A ⊃ B ⊃ C,
 * rendering A−B, B−C and C sums back to A exactly. Subtracting every descendant
 * instead would remove C from A twice.
 */
export function childrenByParent(equipments: readonly NestableEquipment[]): Map<string, string[]> {
  const byParent = new Map<string, string[]>();
  for (const eq of equipments) {
    const parent = eq.meteringParentId;
    if (!parent || parent === eq.id) continue;
    const list = byParent.get(parent);
    if (list) list.push(eq.id);
    else byParent.set(parent, [eq.id]);
  }
  return byParent;
}

/**
 * Each parent's series, minus its direct children's, bucket by bucket.
 *
 * Clamped at 0: two clamps sample at different instants and a child can read
 * more than its parent for one bucket. A negative slice would be nonsense on a
 * stacked chart, and worse, would inflate the residual.
 *
 * Series with no children come back untouched — same array, not a copy — so an
 * installation that declared nothing pays nothing.
 */
export function subtractChildren(
  series: ReadonlyMap<string, NestingPoint[]>,
  children: ReadonlyMap<string, string[]>,
): Map<string, NestingPoint[]> {
  const out = new Map<string, NestingPoint[]>();
  for (const [id, points] of series) {
    const kids = children.get(id);
    if (!kids || kids.length === 0) {
      out.set(id, points);
      continue;
    }
    const childTotals = new Map<string, number>();
    for (const kid of kids) {
      for (const p of series.get(kid) ?? []) {
        childTotals.set(p.time, (childTotals.get(p.time) ?? 0) + p.wh);
      }
    }
    out.set(
      id,
      points.map((p) => ({ time: p.time, wh: Math.max(0, p.wh - (childTotals.get(p.time) ?? 0)) })),
    );
  }
  return out;
}

/**
 * Would declaring `childId` inside `parentId` close a loop?
 *
 * Walks up from the proposed parent: the graph that matters is the one the
 * declaration would create, not the pair on its own — A→B→C→A is only visible
 * from the last edge. The visited set also stops a loop that already exists in
 * the data from hanging the walk.
 */
export function wouldCycle(
  equipments: readonly NestableEquipment[],
  childId: string,
  parentId: string,
): boolean {
  if (childId === parentId) return true;
  const parentOf = new Map(equipments.map((e) => [e.id, e.meteringParentId ?? null] as const));
  const seen = new Set<string>([childId]);
  let cursor: string | null | undefined = parentId;
  while (cursor) {
    if (cursor === childId) return true;
    if (seen.has(cursor)) return false; // pre-existing loop elsewhere, not ours
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
