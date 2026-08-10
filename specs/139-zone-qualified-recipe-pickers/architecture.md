# Architecture — Spec 139

## Flow diagram

```
useZones.tree  (ZoneWithChildren[], already in the client via WebSocket)
  │
  ├─ flattenZonesWithPath(tree)          ← new: ui/src/lib/zone-path.ts
  │     depth-first walk, accumulates ancestors, omits a lone root,
  │     then per name group: shortest suffix that separates the group
  │        → ZoneOption[] = { id, name, label, chain, path, depth }
  │
  ├─ zoneChainMap(options) → Map<zoneId, chain>
  │     └─ equipmentLabelMap(candidates, chains) → Map<eqId, label>
  │           bare name when unique in the list, else name — shortest
  │           zone suffix separating those candidates
  │
  └─ ZoneRecipesSection
        ├─ zone dropdowns          → {z.label}
        ├─ selected-equipment chip → {zone.label}
        ├─ <EquipmentOptions>      → one <option> list, 5 call sites
        └─ <EquipmentCheckboxList> → name + secondary qualifier, 2 call sites
```

Nothing crosses the network: the tree is already in the store, and the paths are
derived in a `useMemo` keyed on it, exactly where the flat lists are built today.

## Components

### New: `ui/src/lib/zone-path.ts`

```ts
export interface ZoneOption {
  id: string;
  name: string;
  /** Shortest ancestor suffix that tells this zone from its homonyms. */
  label: string;
  /** Ancestor names, outermost first, own name last. */
  chain: string[];
  /** The whole chain joined — tooltips, callers wanting everything. */
  path: string;
  /** Depth in the tree, 0 for a root. Drives option indentation. */
  depth: number;
}

/**
 * Flatten the zone tree, labelling every zone with the shortest ancestor suffix
 * that tells it from the zones sharing its name.
 *
 * A single top-level root is omitted from its descendants' chains — it is the
 * whole installation and adds no information (the topbar breadcrumb already
 * treats it as implicit). With several roots, the top level discriminates and
 * every chain is complete.
 */
export function flattenZonesWithPath(tree: ZoneWithChildren[]): ZoneOption[];

/** zoneId → chain lookup, the input of equipmentLabelMap. */
export function zoneChainMap(options: ZoneOption[]): Map<string, string[]>;

/** Candidate labels: bare when unique in the list, `name — zone` when not. */
export function equipmentLabelMap(
  equipments: { id: string; name: string; zoneId: string }[],
  zoneChains: Map<string, string[]>,
): Map<string, string>;
```

The separator is exported as `ZONE_PATH_SEPARATOR = " › "` so the two existing
call sites (`AppLayout` crumbs, and any future adopter) can share it rather than
re-typing the glyph.

### Changed: `ui/src/components/recipes/ZoneRecipesSection.tsx`

The three local flattenings disappear. `SingleEquipmentZonePicker` and
`EquipmentListPicker` take `zones: ZoneOption[]` instead of
`{ id: string; name: string }[]`, and each component that renders equipments
holds the `zoneChainMap` derived from the same memo. Two new local components,
`EquipmentOptions` and `EquipmentCheckboxList`, absorb the five duplicated
`<option>` loops and the two duplicated checkbox lists.

### Changed: `ui/src/components/history/AnalyseView.tsx`

Local `flattenZones()` deleted; its `label` becomes the helper's. `depth` keeps
driving the existing indentation.

## Files changed

| Domain | File                                               | Change                                                                               |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| UI     | `ui/src/lib/zone-path.ts`                          | **New** — `flattenZonesWithPath`, `zoneChainMap`, `equipmentLabelMap`, separator     |
| UI     | `ui/src/lib/zone-path.test.ts`                     | **New** — unit tests                                                                 |
| UI     | `ui/src/components/recipes/ZoneRecipesSection.tsx` | 3 flattenings → helper; 12 render sites qualified; 7 duplicated loops → 2 components |
| UI     | `ui/src/components/history/AnalyseView.tsx`        | Drop local `flattenZones()`, adopt the helper                                        |
| Spec   | `specs/139-.../screenshots/*.png`                  | Before/after evidence captured against a live tree with homonymous rooms             |

No backend file changes: no types, no migration, no route, no event.

## Rendering decisions

| Site                        | Before        | After                        | Why                                               |
| --------------------------- | ------------- | ---------------------------- | ------------------------------------------------- |
| Zone dropdown               | `{z.name}`    | `{z.label}`                  | The dropdown's whole job is to disambiguate zones |
| Equipment `<option>`        | `{eq.name}`   | qualified only when repeated | `<option>` cannot carry styled secondary text     |
| Equipment checkbox row      | `{eq.name}`   | name + grey qualifier        | Real markup available; keeps the name dominant    |
| Selected chip (list picker) | `{zone.name}` | `{zone.label}`               | Same ambiguity, already had a slot for the zone   |

## Alternatives considered

- **Always show the full path.** Implemented first, then rejected on evidence:
  see `screenshots/after-form.png` versus the first attempt — `Maison
Principale › Maison › Salle de bain` truncates the equipment name to `Tem…`
  in the chip and the selection to `VMC — M` in a 3-column grid. Correct and
  unusable.
- **Show only the parent** (one level, always). Cheaper, but breaks as soon as
  two parents share a name (`RDC`/`Étage` under two buildings) — the exact tree
  shape reported in #385.
- **Force unique zone names.** Rejected: names are the user's, and the failure
  mode would be a validation error long after the tree was built.
- **Group `<option>`s under `<optgroup>` per parent.** Solves the equipment
  dropdown but not the zone dropdown, and `optgroup` cannot nest for deeper
  trees.
