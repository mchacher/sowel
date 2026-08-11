# Architecture — Spec 142

## Flow diagram

```
useZones.tree  (ZoneWithChildren[], already in the client via WebSocket)
  │
  ├─ flattenZonesWithPath(tree)                    ← spec 139, unchanged
  │     → ZoneOption[] = { id, name, label, chain, path, depth }
  │       depth-first, a lone root omitted from its descendants' chains
  │
  └─ groupEquipmentsByZone(filtered, options)      ← new, same module
        bucket by eq.zoneId, emit in ZoneOption order,
        drop empty zones, trailing { zone: null } for orphans
          → ZoneGroup<T>[] = { zone: ZoneOption | null, equipments: T[] }
             │
             └─ EquipmentsPage
                   ├─ <ZoneHeading chain={zone?.chain} />   ancestors muted,
                   │                                        own name emphasised
                   └─ <EquipmentCard> per equipment
```

Nothing crosses the network. Both the zone tree and the equipment list are
already in their stores; the grouping is derived where the flat list was built
before, and `flattenZonesWithPath` runs in a `useMemo` keyed on the tree.

## Components

### Extended: `ui/src/lib/zone-path.ts`

```ts
/** One zone's equipments. `zone` is null for equipments whose zone is gone. */
export interface ZoneGroup<T> {
  zone: ZoneOption | null;
  equipments: T[];
}

/**
 * Group equipments by the zone they belong to, in tree order.
 *
 * The key is the zone id, so distinct zones stay distinct however they are
 * named. Groups come back in the order of `zones` — depth-first — zones with no
 * equipment are skipped, and equipments whose zone no longer exists land in a
 * trailing `zone: null` group rather than disappearing.
 */
export function groupEquipmentsByZone<T extends { zoneId: string }>(
  equipments: T[],
  zones: ZoneOption[],
): ZoneGroup<T>[];
```

Generic over `{ zoneId: string }` rather than tied to `EquipmentWithDetails`:
the function needs one field, and any other flat list of zone-owned rows can
reuse it without importing the equipment type.

Implementation: one pass to bucket by `zoneId`, then a walk of `zones` that
emits and `delete`s each bucket it finds. What remains in the map after that
walk is exactly the orphan set — no second membership test, and no reliance on
the zone list being complete.

The module keeps its spec 139 role: **how the zone hierarchy is expressed in
flat controls.** Grouping belongs with labelling because both answer the same
question (which zone is this row really in?) from the same flattened input.

### Changed: `ui/src/pages/EquipmentsPage.tsx`

`groupByZone()` — the local walker that keyed groups by name, sorted them
alphabetically and hardcoded `"Unknown zone"` — is deleted. In its place:

```tsx
const zoneOptions = useMemo(() => flattenZonesWithPath(tree), [tree]);
const byZone = groupEquipmentsByZone(filtered, zoneOptions);
```

`byZone` is intentionally _not_ memoised: `filtered` is rebuilt on every filter
keystroke anyway, and the grouping is two linear passes over lists whose size is
the number of equipments in a house.

`ZoneHeading` replaces the inline `<h3>`, keeping its typography
(`text-[13px] font-semibold uppercase tracking-widest`) and adding the ancestor
prefix in `font-normal text-text-tertiary`. The weight and colour contrast is
what makes the heading scannable — the eye lands on the room, the path is there
when it is needed. `chain` is optional so the same component renders the orphan
group from `t("dashboard.unknownZone")`.

The zone's own name is wrapped in a `whitespace-nowrap` span. The first mobile
screenshot showed why: at 390 px a four-segment path wraps, and it wrapped
_inside_ the name — `MAISON PRINCIPALE › GITE › RDC › SALLE DE / BAIN`, breaking
the one word the reader is scanning for. Keeping the name atomic pushes it whole
onto the second line instead, which is the two-line layout one would have
designed anyway, without spending vertical space when the path does fit.

## Why not indent the groups instead

Reproducing the tree with indented headings was the alternative reading of
"hiérarchiser comme la page Maison". It loses on a list page: equipment cards
are full-width rows, so indenting their headings either indents the cards too
(wasting width at depth 3+, and badly on mobile) or leaves headings floating out
of alignment with the content they label. The breadcrumb carries the same
information in one line, at every depth, and composes with the existing card
layout unchanged. Tree _order_ (FR3) is kept regardless — that is the part of
the `Maison` page's shape that survives flattening.

## Testing

`ui/src/lib/zone-path.test.ts` gains a `groupEquipmentsByZone` block on the same
fixture tree as spec 139 (three `Salle de bain`, two `WC`): homonyms stay apart,
groups follow tree order rather than the alphabet, chains reach the renderer,
empty zones are skipped, several equipments of one zone keep input order,
orphans land in the trailing group, and an empty input yields no group.

No backend test: nothing outside the browser changed.

### Visual check

Driven with Playwright against a live instance whose tree really does repeat
room names (`Salle de bain` in `Gite › RDC`, in `Gite › Etage` and in `Maison`;
`WC` and `Salle à manger` twice each). Screenshots in `screenshots/`:

| File                          | Shows                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| `before-merged-bathrooms.png` | One `SALLE DE BAIN` group holding three rooms' worth of equipment |
| `after-bathroom-rdc.png`      | The same bathroom, now named by its path                          |
| `after-bathroom-maison.png`   | Its homonym in the main house, a separate group                   |
| `after-list.png`              | The whole list: paths and depth-first order                       |
| `after-mobile.png`            | 390 px — path wraps, zone name stays whole                        |

The count is the check that needs no eye: 13 groups before, 17 after, for the
same 22 equipments — the four extra groups are the merged homonyms coming apart.

## Non-impacts

No type, route, event, migration, permission or i18n key is added. The only
behavioural surface is the `Administration › Équipements` page.
