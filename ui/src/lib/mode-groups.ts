import type { Mode } from "../types";

/** Spec 219 — modes split into their groups (sorted by name) and the ungrouped rest. */
export function groupModes<M extends Mode>(
  modes: M[],
): { groups: { name: string; modes: M[] }[]; others: M[] } {
  const byName = new Map<string, M[]>();
  const others: M[] = [];
  for (const mode of modes) {
    if (!mode.group) {
      others.push(mode);
      continue;
    }
    const list = byName.get(mode.group);
    if (list) list.push(mode);
    else byName.set(mode.group, [mode]);
  }
  const groups = [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, modes: list }));
  return { groups, others };
}

/** Spec 219 — the distinct group names in use, sorted. */
export function modeGroupNames(modes: Mode[]): string[] {
  return groupModes(modes).groups.map((g) => g.name);
}
